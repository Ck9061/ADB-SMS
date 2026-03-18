# ADB-SMS 部署指南 - Google Cloud Run

## 已完成的准备工作 ✅

1. ✅ Dockerfile 已创建
2. ✅ cloudbuild.yaml 已配置
3. ✅ 代码已推送到 GitHub: https://github.com/Ck9061/ADB-SMS
4. ✅ GCP Service Account 已配置

## 部署步骤

### 方式一：通过 GCP Console（推荐，最简单）

1. **启用必要的 API**
   - 访问：https://console.cloud.google.com/apis/library
   - 搜索并启用：
     - Cloud Build API
     - Cloud Run API
     - Container Registry API

2. **配置 Cloud Build 触发器**
   - 访问：https://console.cloud.google.com/cloud-build/triggers
   - 点击 "创建触发器"
   - 配置：
     - **名称：** adb-sms-deploy
     - **事件：** 推送到分支
     - **源：** 连接 GitHub 仓库 `Ck9061/ADB-SMS`
     - **分支：** `^main$`
     - **配置类型：** Cloud Build 配置文件
     - **位置：** `/cloudbuild.yaml`
     - **替换变量：**
       - `_GEMINI_API_KEY` = 你的 Gemini API Key

3. **手动触发构建**
   - 在触发器页面，点击 "运行"
   - 等待构建完成（约 3-5 分钟）

4. **获取 URL**
   - 访问：https://console.cloud.google.com/run
   - 找到 `adb-sms` 服务
   - 复制服务 URL

### 方式二：命令行部署（需要 gcloud CLI）

```bash
# 1. 启用 API
gcloud services enable cloudbuild.googleapis.com run.googleapis.com containerregistry.googleapis.com

# 2. 提交构建
gcloud builds submit --config=cloudbuild.yaml --substitutions=_GEMINI_API_KEY="你的API密钥"

# 3. 查看服务
gcloud run services list
```

## 需要的信息

### Gemini API Key
- 获取地址：https://aistudio.google.com/app/apikey
- 用途：应用运行时调用 Gemini AI

## 部署后配置

1. **自定义域名（可选）**
   - Cloud Run > 服务详情 > 管理自定义域名

2. **查看日志**
   - Cloud Run > 服务详情 > 日志

3. **监控**
   - Cloud Run > 服务详情 > 指标

## 预计成本

- Cloud Run：按使用量计费
  - 免费额度：每月 200 万次请求
  - 估计成本：< $5/月（轻度使用）

## 故障排查

### 构建失败
- 检查 Cloud Build 日志
- 确认所有 API 都已启用

### 应用无法启动
- 检查 Cloud Run 日志
- 确认 GEMINI_API_KEY 环境变量已设置

---

**准备好部署了！** 🐶
