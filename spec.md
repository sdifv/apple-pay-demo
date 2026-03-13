# Apple Pay Demo 项目规格说明

## 项目概述

本项目是一个完整的 Apple Pay Web 集成演示，包含前端页面和 Node.js 后端服务，支持商户验证、支付处理以及自定义交易配置。

## 核心功能

1. **商户验证**：后端使用商户身份证书与 Apple 服务器进行 TLS 双向认证
2. **支付处理**：接收 Apple Pay 支付 token 并支持自定义交易配置
3. **交易配置**：支持自定义国家/地区、币种、商户 MCC、商户名称和金额
4. **数据复制**：支付成功后支持复制 paymentData 到剪贴板

## 项目结构

```
apple-pay-demo/
├── server.js              # Node.js 后端服务
├── config.js              # 硬编码配置（证书、商户信息等）
├── package.json           # 项目依赖
├── public/
│   ├── index.html         # Apple Pay 前端页面
│   └── .well-known/
│       └── apple-developer-merchantid-domain-association  # 域名验证文件
└── certs/                 # 证书目录（本地开发用）
    ├── merchant_id_cert.pem
    └── merchant_id_key.pem
```

## 第一阶段：Apple Developer 后台配置

### 1. 创建 Merchant Identity Certificate（商户身份证书）

1. 登录 [Apple Developer](https://developer.apple.com)
2. 进入 **Certificates, Identifiers & Profiles** > **Identifiers** > **Merchant IDs**
3. 选择你的 Merchant ID
4. 点击 **Create Certificate** (Apple Pay Merchant Identity Certificate)
5. 在 Mac 上用 Keychain Access 生成 CSR（Certificate Signing Request）：
   - 打开 Keychain Access > Certificate Assistant > Request a Certificate From a Certificate Authority
   - 填入邮箱，选择 "Saved to disk"
6. 上传 CSR 文件到 Apple Developer 后台
7. 下载生成的 `.cer` 证书，双击导入 Keychain
8. 从 Keychain 导出为 `.p12` 文件（包含私钥）
9. 转换为 `.pem` 格式供服务器使用：

```bash
# 从 .p12 导出证书（纯 PEM 格式）
openssl pkcs12 -in merchant_id.p12 -out merchant_id_cert.pem -clcerts -nokeys

# 从 .p12 导出私钥（纯 PEM 格式）
openssl pkcs12 -in merchant_id.p12 -out merchant_id_key.pem -nocerts -nodes

# 验证证书和私钥匹配
openssl x509 -in merchant_id_cert.pem -noout -modulus | openssl md5
openssl rsa -in merchant_id_key.pem -noout -modulus | openssl md5
```

**重要提示**：必须使用纯 PEM 格式，不能包含 "Bag Attributes" 等额外信息。使用以下命令生成正确的 Base64：

```bash
# 提取纯证书内容并 Base64 编码
openssl x509 -in merchant_id_cert.pem -outform PEM | openssl base64 -A

# 提取纯私钥内容并 Base64 编码
openssl rsa -in merchant_id_key.pem -outform PEM | openssl base64 -A
```

### 2. 注册并验证域名

1. 在同一个 Merchant ID 配置页，找到 **Merchant Domains**
2. 点击 **Add Domain**，输入你的域名（如 `pay.yourdomain.com`）
3. Apple 会要求你下载验证文件 `apple-developer-merchantid-domain-association`
4. 将文件放到服务器的 `https://你的域名/.well-known/apple-developer-merchantid-domain-association` 路径
5. 回到 Apple Developer 后台点击 **Verify**

### 3. 创建 Payment Processing Certificate（可选）

- 如果只需要获取 token 不解密，可以跳过此步骤
- 如果需要自行解密支付数据，则需要创建此证书

## 第二阶段：服务器配置与部署

### 环境要求

- Node.js 14+
- 公网域名 + 有效的 HTTPS 证书（Apple Pay 强制要求）
- 服务器需支持 TLS 1.2+

### 部署到 Railway（推荐）

1. **准备代码**：
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/你的用户名/apple-pay-demo.git
   git push -u origin main
   ```

2. **创建 Railway 项目**：
   - 登录 [Railway](https://railway.app)
   - 点击 **New Project** > **Deploy from GitHub repo**
   - 选择你的仓库

3. **配置环境变量**（可选，也可使用硬编码配置）：
   - `CERT_BASE64`: 商户证书的 Base64 编码
   - `KEY_BASE64`: 私钥的 Base64 编码
   - `MERCHANT_IDENTIFIER`: 你的 Merchant ID
   - `DOMAIN_NAME`: 你的域名

4. **配置自定义域名**：
   - 在 Railway Dashboard 中选择你的服务
   - 点击 **Settings** > **Domains** > **Generate Domain** 或添加自定义域名
   - 将自定义域名在 Apple Developer 后台验证

### 本地开发

```bash
# 安装依赖
npm install

# 启动服务器（HTTP 模式，Apple Pay 无法使用）
node server.js

# 或使用 HTTPS（需要配置证书）
# 将证书放入 certs/ 目录后启动
```

## 第三阶段：核心流程

### 支付流程图

```
用户点击 Apple Pay 按钮
        ↓
浏览器创建 ApplePaySession
        ↓
触发 onvalidatemerchant 事件
        ↓
前端调用后端 POST /validate-merchant
        ↓
后端用商户证书向 Apple 发起 TLS 请求
        ↓
Apple 返回 merchant session
        ↓
前端调用 session.completeMerchantValidation(merchantSession)
        ↓
用户在设备上确认支付（Touch ID / Face ID）
        ↓
触发 onpaymentauthorized 事件
        ↓
前端发送 payment.token + transactionConfig 到后端
        ↓
后端返回处理结果
        ↓
显示支付成功 + 复制 paymentData 按钮
```

### API 接口

#### POST /validate-merchant
商户验证接口，由前端在 `onvalidatemerchant` 事件中调用。

**请求体**：
```json
{
  "validationURL": "https://apple-pay-gateway-cert.apple.com/paymentservices/startSession"
}
```

**响应**：
```json
{
  "epochTimestamp": 1234567890,
  "expiresAt": 1234571490,
  "merchantSessionIdentifier": "...",
  "nonce": "...",
  "merchantIdentifier": "...",
  "domainName": "your-domain.com",
  "displayName": "Your Store",
  "signature": "..."
}
```

#### POST /process-payment
支付处理接口，由前端在 `onpaymentauthorized` 事件中调用。

**请求体**：
```json
{
  "payment": {
    "token": {
      "paymentData": {...},
      "paymentMethod": {...},
      "transactionIdentifier": "..."
    }
  },
  "transactionConfig": {
    "countryCode": "HK",
    "currencyCode": "HKD",
    "merchantMCC": "5399",
    "merchantName": "示例商店",
    "amount": "1.00"
  }
}
```

**响应**：
```json
{
  "success": true,
  "message": "支付 token 已接收",
  "token": {...},
  "transactionConfig": {...},
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### GET /config-check
配置检查接口，用于验证服务器配置是否正确。

**响应**：
```json
{
  "ready": true,
  "checks": {
    "merchantIdentifier": "merchant.test.applepay.alipayplus",
    "domainName": "your-domain.up.railway.app",
    "displayName": "Apple Pay Demo",
    "certExists": true,
    "keyExists": true,
    "certSource": "base64",
    "keySource": "base64"
  },
  "message": "配置检查通过，可以开始测试 Apple Pay"
}
```

## 第四阶段：前端功能

### 交易配置

页面提供以下配置选项：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| 国家/地区 | 支付国家/地区代码 | CN |
| 币种 | 支付币种 | CNY |
| 商户 MCC | 商户类别代码 | 5999 |
| 商户名称 | 显示在 Apple Pay Sheet 上的名称 | 示例商店 |
| 支付金额 | 交易金额 | 9.99 |

**支持的币种**：
- CNY（人民币）
- USD（美元）
- HKD（港币）
- SGD（新加坡元）
- JPY（日元）- 自动取整，不支持小数
- GBP（英镑）
- EUR（欧元）
- AUD（澳元）
- CAD（加元）

### 支付数据复制

支付成功后，页面会显示：
- 支付数据文本框（只读，显示格式化 JSON）
- 复制按钮（支持现代 Clipboard API 和降级方案）
- 复制成功后按钮变绿色，显示"✓ 已复制到剪贴板"

## 常见问题

### 1. 商户验证失败 "key values mismatch"

**原因**：证书和私钥不匹配，或 Base64 编码包含了额外信息（如 Bag Attributes）

**解决**：
```bash
# 使用纯 PEM 格式重新编码
openssl x509 -in merchant_id_cert.pem -outform PEM | openssl base64 -A
openssl rsa -in merchant_id_key.pem -outform PEM | openssl base64 -A
```

### 2. 域名验证失败

**原因**：验证文件未正确放置或 Content-Type 不正确

**解决**：确保文件可通过 `https://你的域名/.well-known/apple-developer-merchantid-domain-association` 访问，且返回 `text/plain` 类型

### 3. 支付被取消（HKD 等币种）

**原因**：金额格式不正确，某些币种如 JPY 不支持小数

**解决**：代码已自动处理，JPY/KRW 等币种会自动取整，其他币种保留两位小数

### 4. Railway 环境变量注入失败

**原因**：Railway 环境变量配置问题

**解决**：使用 `config.js` 硬编码配置作为备选方案

## 分支管理

- `main`：主分支，包含最新功能
- `stable_v1`：稳定版本分支
- `feature/custom-payment-config`：自定义交易配置功能分支（已合并到 main）

## 技术栈

- **后端**：Node.js + Express
- **前端**：原生 HTML + CSS + JavaScript
- **部署**：Railway（自动 HTTPS）
- **证书**：OpenSSL 转换 PEM 格式

## 参考文档

- [Apple Pay on the Web](https://developer.apple.com/documentation/apple_pay_on_the_web)
- [Apple Pay Session](https://developer.apple.com/documentation/apple_pay_on_the_web/applepaysession)
- [Merchant Validation](https://developer.apple.com/documentation/apple_pay_on_the_web/applepaysession/1778027-onvalidatemerchant)
