const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
const port = process.env.PORT || 8080; // 必须监听这个环境变量

// 1. 创建 HTTP 服务
const server = http.createServer(app);

// 2. 创建 WebSocket 服务并绑定到同一个 HTTP 服务上
const wss = new WebSocketServer({ server });

// 基础路由：Cloud Run 访问这里来确认程序在线
app.get('/', (req, res) => {
    res.send('ADB SMS Gateway Server is Running!');
});

// --- WebSocket 转发逻辑 ---
const sessions = {}; 

wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(req.url.split('?')[1]);
    const role = params.get('role');
    const sid = params.get('sessionId') || 'public';

    if (!sessions[sid]) sessions[sid] = { host: null, clients: [] };

    if (role === 'host') {
        sessions[sid].host = ws;
        console.log(`[Host] 手机桥接端已连接: ${sid}`);
    } else {
        sessions[sid].clients.push(ws);
        console.log(`[Client] 客户控制端已连接: ${sid}`);
    }

    ws.on('message', (data) => {
        // 收到客户请求，发给手机
        if (role === 'client' && sessions[sid].host) {
            sessions[sid].host.send(data);
        }
        // 收到手机反馈，发给所有客户
        if (role === 'host') {
            sessions[sid].clients.forEach(c => c.send(data));
        }
    });

    ws.on('close', () => {
        if (role === 'host') sessions[sid].host = null;
        else sessions[sid].clients = sessions[sid].clients.filter(c => c !== ws);
    });
});

// 3. 启动服务
server.listen(port, '0.0.0.0', () => {
    console.log(`✅ 服务端已启动，监听端口: ${port}`);
});