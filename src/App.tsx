import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Smartphone, Send, Terminal, Copy, CheckCircle2, AlertCircle, 
  Link as LinkIcon, MessageSquare, Shield, ExternalLink, History, 
  Settings, Upload, FileText, Play, Pause, RotateCcw, X, 
  ChevronRight, ChevronLeft, MousePointer2, Clock, Users, 
  UserPlus, Trash2, Search, Home, Layers, Power, Volume2, Volume1,
  HelpCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ================= 配置区 =================
// 自动获取当前环境的 WebSocket URL（根据当前页面域名自动适配）
const getWsUrl = () => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
};

type Role = 'host' | 'client';

interface Message {
  id: string;
  number: string;
  text: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  timestamp: number;
  error?: string;
}

interface BulkTask {
  id: string;
  number: string;
  text: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  error?: string;
}

interface Contact {
  id: string;
  name: string;
  number: string;
}

export default function App() {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [hostOnline, setHostOnline] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [smsText, setSmsText] = useState('');
  const [copied, setCopied] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  // 状态：坐标与群发
  const [btnX, setBtnX] = useState(995);
  const [btnY, setBtnY] = useState(2188);
  const [bulkTasks, setBulkTasks] = useState<BulkTask[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sendInterval, setSendInterval] = useState(() => {
    const saved = localStorage.getItem('sms_send_interval');
    return saved ? parseInt(saved) : 12;
  });
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [adbDevices, setAdbDevices] = useState<string>('');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [isRefreshingDevices, setIsRefreshingDevices] = useState(false);
  const [tapDelay, setTapDelay] = useState(() => {
    const saved = localStorage.getItem('sms_tap_delay');
    return saved ? parseInt(saved) : 3000;
  });

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const bridgeCode = `
const WebSocket = require('ws');
const { exec } = require('child_process');

const WS_URL = "${getWsUrl()}?role=host&sessionId=${sessionId}";

console.log("-----------------------------------");
console.log("Bade ADB SMS Bridge 启动中...");
console.log("正在尝试连接到服务器: " + WS_URL);

function connect() {
    const ws = new WebSocket(WS_URL);

    ws.on('open', () => {
        console.log("✅ 已成功连接到服务器！");
        console.log("现在你可以在网页端控制手机了。");
    });

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            const { type, payload } = message;

            if (type === 'SEND_SMS') {
                const { number, text, x, y, deviceId, id } = payload;
                const deviceFlag = deviceId ? \`-s \${deviceId}\` : '';
                console.log(\`[SMS] 正在发送至: \${number} [设备: \${deviceId || '默认'}]\`);
                
                // 唤醒屏幕并解锁
                exec(\`adb \${deviceFlag} shell input keyevent 224 && adb \${deviceFlag} shell wm dismiss-keyguard\`, (err) => {
                    // 增加 500ms 缓冲，确保解锁完成
                    setTimeout(() => {
                        // 打开短信界面
                        const escapedText = text.replace(/"/g, '\\\\"').replace(/\\\\$/g, '\\\\\\\\$');
                        const cmd = \`adb \${deviceFlag} shell am start -a android.intent.action.SENDTO -d sms:\${number} --es sms_body "\${escapedText}" --es android.intent.extra.TEXT "\${escapedText}"\`;
                        
                        exec(cmd, (err) => {
                            if (err) return console.error("❌ 无法打开短信界面:", err);
                            
                            // 等待加载后点击发送
                            setTimeout(() => {
                                exec(\`adb \${deviceFlag} shell input tap \${x} \${y}\`, (err) => {
                                    if (err) {
                                        console.error("❌ 点击发送失败:", err);
                                        ws.send(JSON.stringify({ type: 'STATUS_UPDATE', payload: { id, status: 'failed', error: err.message } }));
                                    } else {
                                        console.log("✅ 发送指令已下达");
                                        ws.send(JSON.stringify({ type: 'STATUS_UPDATE', payload: { id, status: 'sent' } }));
                                    }
                                });
                            }, ${tapDelay});
                        });
                    }, 500);
                });
            }

            if (type === 'GET_DEVICES') {
                exec('adb devices', (err, stdout) => {
                    ws.send(JSON.stringify({ type: 'DEVICES_LIST', payload: stdout }));
                });
            }

            if (type === 'REMOTE_COMMAND') {
                const { command, deviceId } = payload;
                const deviceFlag = deviceId ? \`-s \${deviceId}\` : '';
                exec(\`adb \${deviceFlag} \${command}\`, (err, stdout) => {
                    if (err) console.error(\`❌ 指令执行失败 [\${command}]:\`, err);
                    else console.log(\`✅ 指令执行成功 [\${command}]\`);
                });
            }
        } catch (e) {
            console.error("解析消息失败:", e);
        }
    });

    ws.on('close', () => {
        console.log("❌ 连接已断开，5秒后尝试重连...");
        setTimeout(connect, 5000);
    });

    ws.on('error', (err) => {
        console.error("❌ WebSocket 错误:", err.message);
    });
}

connect();
  `.trim();

  const deviceList = useMemo(() => {
    if (!adbDevices) return [];
    return adbDevices.split('\n').filter(line => line.trim() && !line.startsWith('List of devices')).map(line => line.split(/\s+/)[0]);
  }, [adbDevices]);

  const bulkStats = useMemo(() => ({
    total: bulkTasks.length,
    sent: bulkTasks.filter(t => t.status === 'sent').length,
    failed: bulkTasks.filter(t => t.status === 'failed').length,
    pending: bulkTasks.filter(t => t.status === 'pending').length,
  }), [bulkTasks]);

  // WebSocket 初始化与会话管理
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sId = params.get('session');
    
    if (sId) {
      setSessionId(sId);
      connectToWs(sId);
    }
  }, []);
// 1. 在组件内部添加一个 useEffect，专门监听设备切换
useEffect(() => {
  if (selectedDeviceId) {
    // 尝试从浏览器缓存读取这台手机的专属坐标
    const savedConfig = localStorage.getItem(`config_${selectedDeviceId}`);
    if (savedConfig) {
      const { x, y } = JSON.parse(savedConfig);
      setBtnX(x);
      setBtnY(y);
      addLog(`[记忆] 已自动加载设备 ${selectedDeviceId} 的坐标: ${x}, ${y}`);
    }
  }
}, [selectedDeviceId]); // 当你在下拉菜单切换手机时触发

// 2. 修改坐标滑块的保存逻辑 (在渲染部分的 onChange 中)
const handleXChange = (val: number) => {
  setBtnX(val);
  saveToLocal(val, btnY);
};

const handleYChange = (val: number) => {
  setBtnY(val);
  saveToLocal(btnX, val);
};

const saveToLocal = (x: number, y: number) => {
  if (selectedDeviceId) {
    localStorage.setItem(`config_${selectedDeviceId}`, JSON.stringify({ x, y }));
  }
};
  const connectToWs = (sId: string) => {
    if (ws) {
      ws.close();
      setWs(null);
    }
    
    const socket = new WebSocket(`${getWsUrl()}?role=client&sessionId=${sId}`);
    
    socket.onopen = () => {
      addLog(`✅ 已连接到会话 ${sId}`);
      socket.send(JSON.stringify({ type: 'GET_DEVICES' }));
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'ADB_DEVICES' || data.type === 'DEVICES_LIST') {
          setAdbDevices(data.payload.devices || data.payload);
          setIsRefreshingDevices(false);
        } else if (data.type === 'STATUS_UPDATE') {
          updateMessageStatus(data.payload);
        } else if (data.type === 'HOST_STATUS') {
          setHostOnline(data.payload.online);
          addLog(data.payload.online ? '🟢 控制端已上线' : '🔴 控制端已离线');
        } else if (data.type === 'ERROR') {
          addLog('❌ 错误: ' + data.payload);
        }
      } catch (e) { 
        addLog("收到消息: " + event.data); 
      }
    };

    socket.onclose = () => { 
      setHostOnline(false); 
      addLog('❌ 连接已断开'); 
    };
    
    socket.onerror = (err) => {
      console.error("WebSocket Error:", err);
      addLog('❌ 连接发生错误，请检查网络或 Ngrok 地址');
    };

    setWs(socket);
  };

  const createSession = async () => {
    try {
      const res = await fetch('/api/session/create', { method: 'POST' });
      const data = await res.json();
      setSessionId(data.sessionId);
      window.history.pushState({}, '', `?session=${data.sessionId}`);
      connectToWs(data.sessionId);
    } catch (err) {
      addLog('❌ 创建会话失败');
    }
  };

  // 保存设置到本地
  useEffect(() => {
    localStorage.setItem('sms_send_interval', sendInterval.toString());
  }, [sendInterval]);

  useEffect(() => {
    localStorage.setItem('sms_tap_delay', tapDelay.toString());
  }, [tapDelay]);

  // 群发逻辑
  useEffect(() => {
    if (!isSending || currentIndex >= bulkTasks.length) {
      if (currentIndex >= bulkTasks.length && isSending) {
        setIsSending(false);
        addLog("✅ 批量任务已完成");
      }
      return;
    }

    const task = bulkTasks[currentIndex];
    
    // 如果任务已经完成（发送成功或失败），立即跳到下一个
    if (task.status === 'sent' || task.status === 'failed') {
      setCurrentIndex(prev => prev + 1);
      return;
    }

    // 如果任务是待发送状态，开始发送流程
    if (task.status === 'pending') {
      // 更新状态为发送中
      setBulkTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'sending' } : t));
      
      // 发送短信
      sendSingleSms(task.number, task.text, task.id);
      
      // 设置间隔定时器，到期后进入下一个任务
      timerRef.current = setTimeout(() => {
        setCurrentIndex(prev => prev + 1);
      }, sendInterval * 1000);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isSending, currentIndex, bulkTasks, sendInterval]);

  const addLog = (msg: string) => {
    setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50));
  };

  const updateMessageStatus = (payload: any) => {
    setBulkTasks(prev => prev.map(t => t.id === payload.id ? { ...t, status: payload.status, error: payload.error } : t));
    setMessages(prev => prev.map(m => m.id === payload.id ? { ...m, status: payload.status, error: payload.error } : m));
  };

  const sendSingleSms = (number: string, text: string, id?: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return addLog("❌ 未连接");
    const msgId = id || Math.random().toString(36).substr(2, 9);
    
    if (!id) {
      const newMsg: Message = {
        id: msgId,
        number,
        text,
        status: 'pending',
        timestamp: Date.now()
      };
      setMessages(prev => [newMsg, ...prev].slice(0, 50));
    }

    ws.send(JSON.stringify({ 
      type: 'SEND_SMS', 
      payload: { id: msgId, number, text, x: btnX, y: btnY, deviceId: selectedDeviceId } 
    }));
  };

  const sendRemoteCommand = (command: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      addLog("❌ 未连接到服务器，请先创建会话并运行桥接脚本");
      return;
    }
    if (!hostOnline) {
      addLog("⚠️ 控制端（手机桥接）未上线，请运行本地脚本");
    }
    
    addLog(`发送指令: ${command}`);
    ws.send(JSON.stringify({ 
      type: 'REMOTE_COMMAND', 
      payload: { 
        command: `shell input keyevent ${command}`, 
        deviceId: selectedDeviceId 
      } 
    }));
  };

  const refreshDevices = () => {
    setIsRefreshingDevices(true);
    ws?.send(JSON.stringify({ type: 'GET_DEVICES' }));
  };

  const exportTasks = (format: 'csv' | 'xlsx') => {
    if (bulkTasks.length === 0) return addLog("⚠️ 没有可导出的任务");
    
    const data = bulkTasks.map(t => ({
      '号码': t.number,
      '内容': t.text,
      '状态': t.status === 'sent' ? '已发送' : t.status === 'failed' ? '失败' : t.status === 'sending' ? '发送中' : '待发送',
      '错误信息': t.error || ''
    }));

    if (format === 'csv') {
      const csv = Papa.unparse(data);
      const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.setAttribute("download", `sms_export_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      const ws_sheet = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws_sheet, "SMS Results");
      XLSX.writeFile(wb, `sms_export_${Date.now()}.xlsx`);
    }
    addLog(`✅ 已导出 ${format.toUpperCase()} 格式报告`);
  };

  const handleFileUpload = (file: File) => {
    setFileName(file.name);
    setUploadError(null);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result;
      try {
        let rawData: any[] = [];
        if (file.name.endsWith('.csv')) {
          const results = Papa.parse(content as string, { header: true });
          rawData = results.data;
        } else {
          const workbook = XLSX.read(content, { type: 'binary' });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          rawData = XLSX.utils.sheet_to_json(sheet);
        }

        const tasks = rawData.map((row: any) => {
          // 智能寻找号码列
          const numberKey = Object.keys(row).find(k => 
            /number|phone|手机|号码/i.test(k)
          );
          // 智能寻找内容列
          const textKey = Object.keys(row).find(k => 
            /text|message|内容|短信|test/i.test(k)
          );

          return {
            id: Math.random().toString(36).substr(2, 9),
            number: String(row[numberKey || ''] || '').trim(),
            text: String(row[textKey || ''] || '').trim(),
            status: 'pending' as const
          };
        }).filter((t: any) => t.number && t.text);

        if (tasks.length === 0) {
          setUploadError('未找到有效的号码和内容列');
          addLog('⚠️ 未找到有效的号码和内容列');
        } else {
          setBulkTasks(tasks);
          setCurrentIndex(0);
          addLog(`成功导入 ${tasks.length} 条群发任务`);
        }
      } catch (err) {
        setUploadError('文件解析失败');
        addLog('❌ 文件解析失败');
      }
    };
    if (file.name.endsWith('.csv')) reader.readAsText(file);
    else reader.readAsBinaryString(file);
  };

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragActive(true); };
  const onDragLeave = () => { setDragActive(false); };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFileUpload(e.dataTransfer.files[0]);
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans flex flex-col lg:flex-row">
      {/* 侧边栏：配置区 */}
      <aside className="w-full lg:w-72 bg-zinc-900/30 border-r border-zinc-800 p-6 space-y-8 overflow-y-auto">
        <div className="flex items-center gap-3">
          <Settings className="w-5 h-5 text-emerald-500" />
          <h2 className="font-bold uppercase tracking-widest text-xs text-zinc-400">运行配置</h2>
        </div>

        <div className="space-y-6">
          {/* 坐标校准面板 */}
          <div className="space-y-4 p-4 bg-zinc-900/50 rounded-2xl border border-zinc-800">
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex justify-between">
              <span>X 坐标</span> <span className="text-emerald-500">{btnX}</span>
            </label>
            <input type="range" min="0" max="2500" value={btnX} onChange={e => handleXChange(parseInt(e.target.value))} className="w-full accent-emerald-500" />
            
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex justify-between">
              <span>Y 坐标</span> <span className="text-emerald-500">{btnY}</span>
            </label>
            <input type="range" min="0" max="3500" value={btnY} onChange={e => handleYChange(parseInt(e.target.value))} className="w-full accent-emerald-500" />

            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex justify-between">
              <span>点击延迟 (毫秒)</span> <span className="text-emerald-500">{tapDelay}ms</span>
            </label>
            <input type="range" min="500" max="8000" step="100" value={tapDelay} onChange={e => setTapDelay(parseInt(e.target.value))} className="w-full accent-emerald-500" />
            <p className="text-[8px] text-zinc-600 italic">如果信息没填入就点击了，请调大此值</p>
            
            <button 
              onClick={() => {
                if (!ws || ws.readyState !== WebSocket.OPEN) {
                  addLog("❌ 未连接");
                  return;
                }
                addLog(`测试点击: ${btnX}, ${btnY}`);
                ws.send(JSON.stringify({ 
                  type: 'REMOTE_COMMAND', 
                  payload: { 
                    command: `shell input tap ${btnX} ${btnY}`, 
                    deviceId: selectedDeviceId 
                  } 
                }));
              }}
              className="w-full py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 rounded-lg text-[10px] font-bold uppercase transition-all border border-emerald-500/20"
            >
              🎯 测试点击当前坐标
            </button>
          </div>

          {/* 远程按键 */}
          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => sendRemoteCommand('4')} className="p-2 bg-zinc-800 rounded-lg flex flex-col items-center gap-1 hover:bg-zinc-700 transition-colors">
              <RotateCcw className="w-4 h-4 text-zinc-400" /> <span className="text-[8px]">返回</span>
            </button>
            <button onClick={() => sendRemoteCommand('3')} className="p-2 bg-zinc-800 rounded-lg flex flex-col items-center gap-1 hover:bg-zinc-700 transition-colors">
              <Home className="w-4 h-4 text-emerald-500" /> <span className="text-[8px]">主页</span>
            </button>
            <button onClick={() => sendRemoteCommand('26')} className="p-2 bg-red-500/10 rounded-lg flex flex-col items-center gap-1 hover:bg-red-500/20 transition-colors">
              <Power className="w-4 h-4 text-red-500" /> <span className="text-[8px]">电源</span>
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
              <Smartphone className="w-3 h-3" /> 选择目标设备
            </label>
            <select value={selectedDeviceId} onChange={(e) => setSelectedDeviceId(e.target.value)} className="w-full bg-black border border-zinc-800 rounded-lg p-2 text-xs text-emerald-400 focus:outline-none">
              <option value="">默认设备</option>
              {deviceList.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
            <button onClick={refreshDevices} className="w-full py-2 bg-zinc-800 rounded-lg text-xs font-bold hover:bg-zinc-700 transition-all">刷新设备</button>
          </div>

          {/* 使用指南 */}
          <div className="space-y-4 pt-4 border-t border-zinc-800">
            <div className="flex items-center gap-2 text-zinc-400 font-bold text-[10px] uppercase tracking-widest">
              <HelpCircle className="w-3 h-3" /> 批量发送指南
            </div>
            <div className="space-y-3 text-[10px] text-zinc-500 leading-relaxed">
              <div className="p-3 bg-black/30 rounded-xl border border-zinc-800/50">
                <p className="text-emerald-500 font-bold mb-1">1. 配置坐标</p>
                <p>在上方设置短信 App “发送”按钮的 X/Y 坐标（可在安卓“开发者选项”中开启“指针位置”获取）。</p>
              </div>
              <div className="p-3 bg-black/30 rounded-xl border border-zinc-800/50">
                <p className="text-emerald-500 font-bold mb-1">2. 上传文件</p>
                <p>将包含联系人和内容的表格（CSV/Excel）拖入右侧上传区。</p>
              </div>
              <div className="p-3 bg-black/30 rounded-xl border border-zinc-800/50">
                <p className="text-emerald-500 font-bold mb-1">3. 开始发送</p>
                <p>点击“开始任务”。手机将自动亮屏、解锁、跳转短信界面并点击发送。</p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* 主界面 */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="border-b border-zinc-800 p-4 sticky top-0 bg-[#050505]/80 backdrop-blur-md z-10">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center border border-emerald-500/20"><Smartphone className="w-6 h-6 text-emerald-500" /></div>
              <div>
                <h1 className="font-bold text-xl">Just Send SMS</h1>
                <div className={`text-[10px] uppercase font-bold ${hostOnline ? 'text-emerald-500' : 'text-red-500'}`}>
                  {hostOnline ? '● 控制端在线' : '○ 等待连接...'}
                  {sessionId && <span className="ml-2 text-zinc-500">会话: {sessionId}</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!sessionId ? (
                <button 
                  onClick={createSession}
                  className="px-4 py-2 bg-emerald-500 text-black font-bold rounded-xl text-xs flex items-center gap-2 hover:bg-emerald-400 transition-all"
                >
                  <UserPlus className="w-3 h-3" /> 创建新会话
                </button>
              ) : (
                <button 
                  onClick={() => { 
                    navigator.clipboard.writeText(window.location.href); 
                    setCopied(true); 
                    setTimeout(() => setCopied(false), 2000); 
                  }} 
                  className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs flex items-center gap-2 hover:bg-zinc-800 transition-all"
                >
                  {copied ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <LinkIcon className="w-3 h-3" />} 
                  分享链接
                </button>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-6xl w-full mx-auto p-6 space-y-6 overflow-y-auto">
          {/* 单发 */}
          <section className="bg-zinc-900/50 rounded-3xl border border-zinc-800 p-6 space-y-4">
            <div className="flex items-center gap-2 text-emerald-500 font-bold text-sm"><MessageSquare className="w-4 h-4" /> 单条发送</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input type="tel" placeholder="接收号码" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} className="bg-black border border-zinc-800 rounded-xl p-3 focus:border-emerald-500 outline-none transition-all" />
              <input type="text" placeholder="短信内容" value={smsText} onChange={e => setSmsText(e.target.value)} className="bg-black border border-zinc-800 rounded-xl p-3 focus:border-emerald-500 outline-none transition-all" />
            </div>
            <button onClick={() => sendSingleSms(phoneNumber, smsText)} disabled={!hostOnline} className="w-full py-4 bg-emerald-500 text-black font-bold rounded-2xl hover:bg-emerald-400 disabled:bg-zinc-800 transition-all flex items-center justify-center gap-2"><Send className="w-5 h-5" /> 立即发送</button>
          </section>

          {/* 历史记录 */}
          {messages.length > 0 && (
            <section className="bg-zinc-900/50 rounded-3xl border border-zinc-800 overflow-hidden">
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/30">
                <h3 className="text-xs font-bold uppercase text-zinc-400">发送历史</h3>
                <button onClick={() => setMessages([])} className="text-[10px] text-zinc-600 hover:text-zinc-400">清除历史</button>
              </div>
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-zinc-900 text-zinc-500 uppercase text-[9px] font-bold">
                    <tr>
                      <th className="p-3 pl-6">状态</th>
                      <th className="p-3">号码</th>
                      <th className="p-3">内容</th>
                      <th className="p-3">时间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {messages.map((msg) => (
                      <tr key={msg.id} className="hover:bg-white/5 transition-colors">
                        <td className="p-3 pl-6">
                          <div className="flex items-center gap-2">
                            {msg.status === 'sent' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                            {msg.status === 'failed' && <AlertCircle className="w-4 h-4 text-red-500" />}
                            {msg.status === 'sending' && <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />}
                            {msg.status === 'pending' && <Clock className="w-4 h-4 text-zinc-600" />}
                            <span className={cn(
                              "text-[9px] font-bold uppercase",
                              msg.status === 'sent' && "text-emerald-500",
                              msg.status === 'failed' && "text-red-500",
                              msg.status === 'sending' && "text-blue-400",
                              msg.status === 'pending' && "text-zinc-500"
                            )}>
                              {msg.status === 'sent' ? '成功' : msg.status === 'failed' ? '失败' : msg.status === 'sending' ? '发送中' : '等待'}
                            </span>
                          </div>
                        </td>
                        <td className="p-3 font-mono text-zinc-300">{msg.number}</td>
                        <td className="p-3 text-zinc-500 truncate max-w-[150px]">{msg.text}</td>
                        <td className="p-3 text-zinc-600">{new Date(msg.timestamp).toLocaleTimeString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 批量发送 - 文件上传 */}
          <section className="bg-zinc-900/50 rounded-3xl border border-zinc-800 p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-500 font-bold text-sm"><Upload className="w-4 h-4" /> 批量导入</div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">支持 .csv / .xlsx</div>
            </div>

            <div 
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              className={cn(
                "border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center gap-3 transition-all cursor-pointer",
                dragActive ? "border-emerald-500 bg-emerald-500/5" : "border-zinc-800 hover:border-zinc-700 bg-black/20"
              )}
              onClick={() => document.getElementById('file-upload')?.click()}
            >
              <input 
                id="file-upload"
                type="file" 
                className="hidden" 
                accept=".csv, .xlsx, .xls"
                onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
              />
              <div className="w-12 h-12 bg-zinc-800 rounded-full flex items-center justify-center">
                <FileText className="w-6 h-6 text-zinc-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">{fileName || "点击或拖拽文件到此处"}</p>
                <p className="text-xs text-zinc-500 mt-1">请确保包含 'number' 和 'text' 列</p>
              </div>
              {uploadError && <p className="text-xs text-red-500 mt-2 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {uploadError}</p>}
            </div>

            {bulkTasks.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-black rounded-2xl border border-zinc-800">
                  <div className="flex items-center gap-4">
                    <div className="space-y-1">
                      <p className="text-[10px] text-zinc-500 uppercase font-bold">发送间隔 (秒)</p>
                      <div className="flex items-center gap-3">
                        <Clock className="w-4 h-4 text-zinc-400" />
                        <input 
                          type="number" 
                          value={sendInterval} 
                          onChange={e => setSendInterval(parseInt(e.target.value) || 1)}
                          className="bg-transparent border-none text-sm font-bold w-12 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {!isSending ? (
                      <button 
                        onClick={() => setIsSending(true)}
                        disabled={!hostOnline || currentIndex >= bulkTasks.length}
                        className="px-6 py-2 bg-emerald-500 text-black font-bold rounded-xl text-xs flex items-center gap-2 hover:bg-emerald-400 disabled:bg-zinc-800 transition-all"
                      >
                        <Play className="w-3 h-3" /> 开始任务
                      </button>
                    ) : (
                      <button 
                        onClick={() => setIsSending(false)}
                        className="px-6 py-2 bg-zinc-800 text-white font-bold rounded-xl text-xs flex items-center gap-2 hover:bg-zinc-700 transition-all"
                      >
                        <Pause className="w-3 h-3" /> 暂停
                      </button>
                    )}
                    <button 
                      onClick={() => { setIsSending(false); setCurrentIndex(0); setBulkTasks(prev => prev.map(t => ({ ...t, status: 'pending' }))); }}
                      className="p-2 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-400 hover:text-white transition-all"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => { setIsSending(false); setBulkTasks([]); setFileName(null); }}
                      className="p-2 bg-zinc-900 border border-zinc-800 rounded-xl text-red-500/50 hover:text-red-500 transition-all"
                      title="清空列表"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    {bulkStats.failed > 0 && (
                      <button 
                        onClick={() => {
                          setBulkTasks(prev => prev.map(t => t.status === 'failed' ? { ...t, status: 'pending', error: undefined } : t));
                          setCurrentIndex(0);
                          setIsSending(true);
                        }}
                        className="px-3 py-2 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl text-[10px] font-bold uppercase hover:bg-red-500/20 transition-all"
                        title="重试失败任务"
                      >
                        重试失败
                      </button>
                    )}
                    <div className="flex gap-1">
                      <button 
                        onClick={() => exportTasks('csv')}
                        className="p-2 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-400 hover:text-white transition-all text-[10px] font-bold"
                        title="导出 CSV"
                      >
                        CSV
                      </button>
                      <button 
                        onClick={() => exportTasks('xlsx')}
                        className="p-2 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-400 hover:text-white transition-all text-[10px] font-bold"
                        title="导出 Excel"
                      >
                        XLSX
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  <div className="bg-black/40 p-3 rounded-xl border border-zinc-800/50 text-center">
                    <p className="text-[9px] text-zinc-500 uppercase font-bold mb-1">总计</p>
                    <p className="text-lg font-bold">{bulkStats.total}</p>
                  </div>
                  <div className="bg-emerald-500/5 p-3 rounded-xl border border-emerald-500/10 text-center">
                    <p className="text-[9px] text-emerald-500/50 uppercase font-bold mb-1">已发送</p>
                    <p className="text-lg font-bold text-emerald-500">{bulkStats.sent}</p>
                  </div>
                  <div className="bg-red-500/5 p-3 rounded-xl border border-red-500/10 text-center">
                    <p className="text-[9px] text-red-500/50 uppercase font-bold mb-1">失败</p>
                    <p className="text-lg font-bold text-red-500">{bulkStats.failed}</p>
                  </div>
                  <div className="bg-zinc-800/20 p-3 rounded-xl border border-zinc-800/50 text-center">
                    <p className="text-[9px] text-zinc-500 uppercase font-bold mb-1">待发送</p>
                    <p className="text-lg font-bold">{bulkStats.pending}</p>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* 批量任务详情列表 */}
          {bulkTasks.length > 0 && (
            <section className="bg-zinc-900/50 rounded-3xl border border-zinc-800 overflow-hidden">
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/30">
                <h3 className="text-xs font-bold uppercase text-zinc-400">任务队列</h3>
                <div className="text-[10px] text-zinc-500">当前执行: {currentIndex + 1} / {bulkTasks.length}</div>
              </div>
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-zinc-900 text-zinc-500 uppercase text-[9px] font-bold">
                    <tr>
                      <th className="p-3 pl-6">状态</th>
                      <th className="p-3">号码</th>
                      <th className="p-3">内容</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {bulkTasks.map((task, idx) => (
                      <tr key={task.id} className={cn("transition-colors", idx === currentIndex && "bg-emerald-500/5")}>
                        <td className="p-3 pl-6">
                          <div className="flex items-center gap-2">
                            {task.status === 'sent' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                            {task.status === 'failed' && <AlertCircle className="w-4 h-4 text-red-500" />}
                            {task.status === 'sending' && <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />}
                            {task.status === 'pending' && <Clock className="w-4 h-4 text-zinc-600" />}
                            <span className={cn(
                              "text-[10px] font-bold uppercase",
                              task.status === 'sent' && "text-emerald-500",
                              task.status === 'failed' && "text-red-500",
                              task.status === 'sending' && "text-blue-400",
                              task.status === 'pending' && "text-zinc-500"
                            )}>
                              {task.status === 'sent' ? '成功' : task.status === 'failed' ? '失败' : task.status === 'sending' ? '发送中' : '等待'}
                            </span>
                          </div>
                          {task.error && <div className="text-[9px] text-red-400/60 mt-1 ml-6">{task.error}</div>}
                        </td>
                        <td className="p-3 font-mono text-zinc-300">{task.number}</td>
                        <td className="p-3 text-zinc-500 truncate max-w-[200px]">{task.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 群发进度 */}
          {bulkTasks.length > 0 && (
            <section className="bg-zinc-900/50 rounded-3xl border border-zinc-800 p-6 space-y-4">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2 font-bold"><Play className="w-4 h-4 text-emerald-500" /> 批量任务进度</div>
                <div className="text-[10px] text-zinc-500">进度: {Math.min(Math.round((currentIndex / bulkTasks.length) * 100), 100)}% ({currentIndex}/{bulkTasks.length})</div>
              </div>
              <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                <div 
                  className="bg-emerald-500 h-full transition-all duration-500 ease-out" 
                  style={{ width: `${(currentIndex / bulkTasks.length) * 100}%` }}
                ></div>
              </div>
              <div className="flex justify-between text-[9px] text-zinc-500 uppercase font-bold">
                <span className="text-emerald-500">成功: {bulkStats.sent}</span>
                <span className="text-red-500">失败: {bulkStats.failed}</span>
                <span>待办: {bulkStats.pending}</span>
              </div>
            </section>
          )}

          {/* 日志 */}
          <section className="bg-zinc-900/50 rounded-3xl border border-zinc-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold uppercase text-zinc-500">实时日志</h3>
              <button onClick={() => setLogs([])} className="text-[10px] text-zinc-600 hover:text-zinc-400">清除日志</button>
            </div>
            <div className="bg-black p-4 rounded-xl font-mono text-[10px] h-40 overflow-y-auto flex flex-col-reverse gap-1 border border-zinc-800/50">
              {logs.map((log, i) => <div key={i} className={cn("text-zinc-500", log.includes('✅') && "text-emerald-500/80")}>{log}</div>)}
              {logs.length === 0 && <div className="text-zinc-800 italic">等待系统指令...</div>}
            </div>
          </section>

          {/* 桥接代码导出 */}
          {sessionId && (
            <section className="bg-zinc-900/50 rounded-3xl border border-zinc-800 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-500 font-bold text-sm"><Shield className="w-4 h-4" /> 本地桥接配置</div>
                <div className="text-[10px] text-zinc-500 uppercase font-bold">运行于本地 Node.js</div>
              </div>
              <p className="text-xs text-zinc-500">复制下方代码并在你的电脑上运行 (需安装 Node.js 和 ADB)。这将允许网页端通过你的电脑发送短信。</p>
              <div className="relative group">
                <pre className="bg-black p-4 rounded-xl text-[10px] font-mono text-emerald-500/70 overflow-x-auto border border-zinc-800 group-hover:border-emerald-500/30 transition-all max-h-40">
                  {bridgeCode}
                </pre>
                <button 
                  onClick={() => { navigator.clipboard.writeText(bridgeCode); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                  className="absolute top-2 right-2 p-2 bg-zinc-900/80 rounded-lg border border-zinc-800 hover:bg-zinc-800 transition-all"
                >
                  {copied ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}