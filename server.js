const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'public', 'data');
const DATA_FILE = path.join(DATA_DIR, 'toys.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 4), 'utf8');
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 5;
const DEFAULT_SORT = 'none';
const VALID_SORT_VALUES = ['none', 'asc', 'desc'];

function readToysData() {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Ошибка чтения файла:', error);
        return {};
    }
}

function writeToysData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4), 'utf8');
        return true;
    } catch (error) {
        console.error('Ошибка записи файла:', error);
        return false;
    }
}

function findToyById(id) {
    const toys = readToysData();
    return toys[id] ? { id, description: toys[id] } : null;
}

app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'views', 'index.ejs');
    let bodyContent = '';
    try {
        bodyContent = fs.readFileSync(indexPath, 'utf8');
    } catch (err) {
        bodyContent = '<h2>Добро пожаловать!</h2><p>Интернет-магазин детских игрушек</p>';
    }
    res.render('layout', { title: 'О магазине', body: bodyContent });
});

app.get('/catalog', (req, res) => {
    const catalogPath = path.join(__dirname, 'views', 'catalog.ejs');
    let bodyContent = '';
    try {
        bodyContent = fs.readFileSync(catalogPath, 'utf8');
    } catch (err) {
        bodyContent = '<h2>Каталог игрушек</h2><p>Управление списком игрушек</p>';
    }
    res.render('layout', { title: 'Каталог игрушек', body: bodyContent });
});

app.get('/chat', (req, res) => {
    const chatPath = path.join(__dirname, 'views', 'chat.ejs');
    let bodyContent = '';
    try {
        bodyContent = fs.readFileSync(chatPath, 'utf8');
    } catch (err) {
        bodyContent = '<h2>Чат</h2><p>Страница чата</p>';
    }
    res.render('layout', { title: 'Чат', body: bodyContent });
});

app.get('/api/toys', (req, res) => {
    const { page, limit, sort, search } = req.query;
    const result = getToysWithPagination({ page, limit, sort, search });
    res.json(result);
});

app.get('/api/toys/:id', (req, res) => {
    const id = decodeURIComponent(req.params.id);
    const toy = findToyById(id);

    if (toy) {
        res.json(toy);
    } else {
        res.status(404).json({ error: 'Игрушка не найдена' });
    }
});

app.post('/api/toys', (req, res) => {
    const { key, value } = req.body;

    if (!key || !value) {
        return res.status(400).json({ error: 'Не указаны название или описание' });
    }

    const toys = readToysData();

    if (toys[key]) {
        return res.status(409).json({ error: 'Игрушка с таким названием уже существует' });
    }

    toys[key] = value;

    if (writeToysData(toys)) {
        res.status(201).json({ success: true, message: `Игрушка "${key}" сохранена`, data: { key, value } });
    } else {
        res.status(500).json({ error: 'Ошибка сохранения' });
    }
});

app.put('/api/toys/:id', (req, res) => {
    const id = decodeURIComponent(req.params.id);
    const { value } = req.body;

    if (!value) {
        return res.status(400).json({ error: 'Не указано описание игрушки' });
    }

    const toys = readToysData();

    if (!toys[id]) {
        return res.status(404).json({ error: 'Игрушка не найдена' });
    }

    toys[id] = value;

    if (writeToysData(toys)) {
        res.json({ success: true, message: `Игрушка "${id}" обновлена`, data: { id, value } });
    } else {
        res.status(500).json({ error: 'Ошибка обновления' });
    }
});

app.delete('/api/toys/:id', (req, res) => {
    const id = decodeURIComponent(req.params.id);
    const toys = readToysData();

    if (!toys[id]) {
        return res.status(404).json({ error: 'Игрушка не найдена' });
    }

    delete toys[id];

    if (writeToysData(toys)) {
        res.json({ success: true, message: `Игрушка "${id}" удалена` });
    } else {
        res.status(500).json({ error: 'Ошибка удаления' });
    }
});

app.get('/download-toys', (req, res) => {
    res.download(DATA_FILE, 'toys_catalog.json', (err) => {
        if (err) {
            console.error('Ошибка скачивания:', err);
            res.status(500).send('Ошибка при скачивании файла');
        }
    });
});


/**
 * Получение игрушек с фильтрацией, сортировкой и пагинацией
 * @param {Object} params - параметры запроса
 * @param {number} params.page - номер страницы (1-indexed)
 * @param {number} params.limit - количество записей на странице
 * @param {string} params.sort - тип сортировки ('none', 'asc', 'desc')
 * @param {string} params.search - поисковый запрос
 * @returns {Object} - объект с данными и мета-информацией
 */
function getToysWithPagination({ page = DEFAULT_PAGE, limit = DEFAULT_LIMIT, sort = DEFAULT_SORT, search = '' }) {
    const pageNum = Math.max(1, parseInt(page) || DEFAULT_PAGE);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || DEFAULT_LIMIT));
    const sortType = VALID_SORT_VALUES.includes(sort) ? sort : DEFAULT_SORT;
    const searchTerm = (search || '').trim().toLowerCase();

    const allToys = readToysData();
    const entries = Object.entries(allToys);

    let filteredEntries = entries;
    if (searchTerm) {
        filteredEntries = entries.filter(([name, description]) => {
            return name.toLowerCase().includes(searchTerm);
        });
    }

    if (sortType === 'asc') {
        filteredEntries.sort((a, b) => a[0].localeCompare(b[0], 'ru'));
    } else if (sortType === 'desc') {
        filteredEntries.sort((a, b) => b[0].localeCompare(a[0], 'ru'));
    }

    const totalItems = filteredEntries.length;

    const totalPages = Math.ceil(totalItems / limitNum);
    const currentPage = Math.min(pageNum, totalPages > 0 ? totalPages : 1);
    const startIndex = (currentPage - 1) * limitNum;
    const endIndex = startIndex + limitNum;
    const paginatedEntries = filteredEntries.slice(startIndex, endIndex);

    const items = {};
    for (const [key, value] of paginatedEntries) {
        items[key] = value;
    }

    return {
        items: items,
        totalItems: totalItems,
        totalPages: totalPages,
        currentPage: currentPage,
        limit: limitNum,
        sort: sortType,
        search: searchTerm
    };
}

const MAX_HISTORY = 50;
let messageHistory = [];

function addToHistory(username, message, userId) {
    const newMessage = {
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        username: username,
        message: message,
        timestamp: new Date().toISOString(),
        userId: userId
    };
    messageHistory.push(newMessage);
    if (messageHistory.length > MAX_HISTORY) {
        messageHistory = messageHistory.slice(-MAX_HISTORY);
    }
    return newMessage;
}

function getHistory() {
    return messageHistory;
}

const activeUsers = {};

io.on('connection', (socket) => {
    console.log('Новый пользователь подключился, ID:', socket.id);

    socket.on('user join', (username) => {
        socket.username = username;
        activeUsers[socket.id] = username;

        console.log(`Пользователь "${username}" присоединился к чату`);

        const history = getHistory();
        socket.emit('chat history', history);

        io.emit('users list', Object.values(activeUsers));

        const joinMessage = addToHistory('Система', `Пользователь ${username} присоединился к чату`, 'system');
        io.emit('system message', joinMessage);
    });

    socket.on('chat message', (data) => {
        const { message } = data;
        const username = socket.username || 'Аноним';

        console.log(`Сообщение от ${username}: ${message}`);

        const newMessage = addToHistory(username, message, socket.id);

        io.emit('chat message', newMessage);
    });

    socket.on('typing', (isTyping) => {
        if (socket.username) {
            socket.broadcast.emit('user typing', {
                username: socket.username,
                isTyping: isTyping
            });
        }
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            console.log(`Пользователь "${socket.username}" отключился`);

            delete activeUsers[socket.id];

            io.emit('users list', Object.values(activeUsers));

            const leaveMessage = addToHistory('Система', `Пользователь ${socket.username} покинул чат`, 'system');
            io.emit('system message', leaveMessage);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});