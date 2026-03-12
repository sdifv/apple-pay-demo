### 第一阶段：Apple Developer 后台配置

你已经创建了 Merchant ID，接下来还需要：

#### 1. 创建 Merchant Identity Certificate（商户身份证书）

- 登录 Apple Developer
- 进入 Certificates, Identifiers & Profiles > Identifiers > Merchant IDs
- 选择你的 Merchant ID
- 点击 Create Certificate (Apple Pay Merchant Identity Certificate)
- 你需要在 Mac 上用 Keychain Access 生成一个 CSR（Certificate Signing Request）：
  - 打开 Keychain Access > Certificate Assistant > Request a Certificate From a Certificate Authority
  - 填入邮箱，选择 "Saved to disk"
- 上传这个 CSR 文件到 Apple Developer 后台
- 下载生成的 .cer 证书，双击导入 Keychain
- 从 Keychain 导出为 .p12 文件（包含私钥）
- 然后转换为 .pem 格式供服务器使用：

```bash
# 从 .p12 导出证书
openssl pkcs12 -in merchant_id.p12 -out merchant_id_cert.pem -clcerts -nokeys

# 从 .p12 导出私钥
openssl pkcs12 -in merchant_id.p12 -out merchant_id_key.pem -nocerts -nodes
```
#### 2. 注册并验证你的域名
在同一个 Merchant ID 配置页，找到 Merchant Domains
点击 Add Domain，输入你的域名（如 pay.yourdomain.com）
Apple 会要求你下载一个验证文件 apple-developer-merchantid-domain-association
将此文件放到你的服务器的 https://你的域名/.well-known/apple-developer-merchantid-domain-association 路径下
回到 Apple Developer 后台点击 Verify
#### 3. 创建 Payment Processing Certificate（可选）
因为你只需要拿 token 不需要解密，这步可以先跳过
如果以后需要自己解密 token，则需要这个证书

### 第二阶段：服务器配置
你只需要一个非常简单的后端，我推荐用 Node.js，代码很少：

重要提示： Apple Pay Web 集成不能纯前端完成，最少需要一个后端接口。原因是 Apple Pay 的流程中有一个 商户验证 (Merchant Validation) 步骤，必须由你的服务器用商户证书去调用 Apple 的服务器，这涉及私钥，不能暴露在浏览器端。下面是从你现在的状态（已创建 Merchant ID）到拿到支付 Payload 的完整步骤。

完整流程
#### 第 1 步：在 Apple Developer 后台完成证书配置
你需要在 Apple Developer - Certificates, Identifiers & Profiles 中完成以下操作：
- 创建 Merchant Identity Certificate（商户身份证书）
进入 Identifiers -> Merchant IDs -> 选你创建的 Merchant ID
- 点击 "Create Certificate" -> 选择 Apple Pay Merchant Identity Certificate
这个证书用于你的服务器在商户验证时向 Apple 发起 TLS 双向认证请求
按照提示用 Keychain Access 生成 CSR 文件，上传，下载 .cer 文件
- 双击 .cer 导入 Keychain，然后导出为 .p12 文件（含私钥）
- 创建 Apple Pay Payment Processing Certificate（支付处理证书）
- 同样在 Merchant ID 详情页，创建 Payment Processing Certificate
这个证书用于加密支付数据（即使你不实际扣款，Apple 也需要它来加密 token）
注册并验证你的域名
- 在 Merchant ID 详情页 -> "Merchant Domains" -> 添加你的域名
Apple 会要求你下载一个验证文件 apple-developer-merchantid-domain-association
你必须把这个文件放在你的服务器上：https://你的域名/.well-known/apple-developer-merchantid-domain-association
Apple 验证通过后，域名状态会变成 ✅ Verified
#### 第 2 步：准备服务器
你至少需要：
一个公网域名 + 有效的 HTTPS 证书（Apple Pay 要求 HTTPS）
一个后端服务（任何语言都行，哪怕是最简单的 Node.js 脚本）
服务器需要：
托管前端页面
提供 /.well-known/apple-developer-merchantid-domain-association 验证文件
提供一个 /validate-merchant API 接口
#### 第 3 步：代码实现
我现在帮你写好前端页面和一个最小化的 Node.js 后端。你想让我把代码生成到哪个目录？下面先给你一个大概的代码结构预览：

```text
apple-pay-demo/
├── server.js              # Node.js 后端（商户验证接口）
├── public/
│   ├── index.html         # Apple Pay 前端页面
│   └── .well-known/
│       └── apple-developer-merchantid-domain-association  # 域名验证文件
├── certs/
│   └── merchant.p12       # 你的商户身份证书（需你自己放入）
└── package.json
```
核心流程图：
```text
用户点击 Apple Pay 按钮
        ↓
浏览器创建 ApplePaySession
        ↓
触发 onvalidatemerchant 事件
        ↓
前端调用你的后端 /validate-merchant
        ↓
后端用 merchant.p12 证书向 Apple 发起 TLS 请求
        ↓
Apple 返回 merchant session
        ↓
前端调用 session.completeMerchantValidation(merchantSession)
        ↓
用户在设备上确认支付（Touch ID / Face ID）
        ↓
触发 onpaymentauthorized 事件
        ↓
你拿到 event.payment.token  ← 这就是你要的 Payload
```