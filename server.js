const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { HARDCODED_CONFIG } = require('./config');

const app = express();
const PORT = process.env.PORT || 443;

// 中间件
app.use(express.json());

// Apple Pay 域名验证文件
app.get('/.well-known/apple-developer-merchantid-domain-association', (req, res) => {
  const filePath = path.join(__dirname, 'public', '.well-known', 'apple-developer-merchantid-domain-association');
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Verification file not found');
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(content));
    res.setHeader('Cache-Control', 'public, max-age=0');
    res.send(content);
  } catch (err) {
    console.error('[Apple Pay] 验证文件读取失败:', err.message);
    res.status(500).send('Error reading verification file');
  }
});

// 静态文件服务
app.use(express.static('public'));

// ==================== 配置区域 ====================
// 请根据你的实际情况修改以下配置

// 配置已从 config.js 导入

// 启动日志
console.log('[Apple Pay] 服务器启动中...');
console.log('[Apple Pay] Merchant ID:', HARDCODED_CONFIG.merchantIdentifier);
console.log('[Apple Pay] Domain:', HARDCODED_CONFIG.domainName);

// Apple Pay 配置
const APPLE_PAY_CONFIG = {
  // 你的 Merchant ID
  merchantIdentifier: HARDCODED_CONFIG.merchantIdentifier,
  
  // 你的域名
  domainName: HARDCODED_CONFIG.domainName,
  
  // 显示名称
  displayName: HARDCODED_CONFIG.displayName,
  
  // Apple 验证服务器地址
  appleValidationURL: 'https://apple-pay-gateway.apple.com/paymentservices/startSession'
};

// 证书配置
const CERT_CONFIG = {
  // 商户身份证书路径（本地开发用）
  certPath: './certs/merchant_id_cert.pem',
  
  // 私钥路径（本地开发用）
  keyPath: './certs/merchant_id_key.pem',
  
  // CA 证书（可选）
  caPath: null,
  
  // 直接传入证书内容（Base64 编码）- 优先使用硬编码
  certBase64: HARDCODED_CONFIG.certBase64,
  keyBase64: HARDCODED_CONFIG.keyBase64
};

// ==================== API 路由 ====================

/**
 * 商户验证接口
 * 这是 Apple Pay 的核心接口，前端在 onvalidatemerchant 事件时调用
 */
app.post('/validate-merchant', async (req, res) => {
  try {
    const { validationURL } = req.body;

    if (!validationURL) {
      return res.status(400).json({ 
        error: 'Missing validationURL',
        message: '请提供 Apple 的验证 URL'
      });
    }

    console.log('[Apple Pay] 开始商户验证...');
    console.log('[Apple Pay] 验证 URL:', validationURL);

    // 读取证书（支持文件路径或 Base64 环境变量）
    let cert, key;
    try {
      if (CERT_CONFIG.certBase64 && CERT_CONFIG.keyBase64) {
        // 从环境变量读取 Base64 编码的证书
        cert = Buffer.from(CERT_CONFIG.certBase64, 'base64');
        key = Buffer.from(CERT_CONFIG.keyBase64, 'base64');
        console.log('[Apple Pay] 从环境变量加载证书');
      } else {
        // 从文件读取证书
        cert = fs.readFileSync(CERT_CONFIG.certPath);
        key = fs.readFileSync(CERT_CONFIG.keyPath);
        console.log('[Apple Pay] 从文件加载证书');
      }
    } catch (err) {
      console.error('[Apple Pay] 证书读取失败:', err.message);
      return res.status(500).json({
        error: 'Certificate Error',
        message: '无法读取商户证书，请确保证书文件存在且路径正确',
        details: err.message
      });
    }

    // 构建请求 Apple 服务器的 payload
    const payload = JSON.stringify({
      merchantIdentifier: APPLE_PAY_CONFIG.merchantIdentifier,
      domainName: APPLE_PAY_CONFIG.domainName,
      displayName: APPLE_PAY_CONFIG.displayName
    });

    // 请求配置
    const requestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      cert: cert,
      key: key,
      // 严格验证证书（生产环境建议保持）
      rejectUnauthorized: true
    };

    // 向 Apple 服务器发起请求
    console.log('[Apple Pay] 请求 Apple 服务器...');
    console.log('[Apple Pay] Payload:', payload);
    
    const merchantSession = await new Promise((resolve, reject) => {
      const appleReq = https.request(validationURL, requestOptions, (appleRes) => {
        let data = '';
        
        appleRes.on('data', (chunk) => {
          data += chunk;
        });
        
        appleRes.on('end', () => {
          console.log('[Apple Pay] Apple 响应状态:', appleRes.statusCode);
          console.log('[Apple Pay] Apple 响应数据:', data.substring(0, 500));
          
          if (appleRes.statusCode === 200) {
            try {
              const session = JSON.parse(data);
              resolve(session);
            } catch (e) {
              reject(new Error(`解析 Apple 响应失败: ${e.message}`));
            }
          } else {
            reject(new Error(`Apple 服务器返回错误: ${appleRes.statusCode} - ${data}`));
          }
        });
      });

      appleReq.on('error', (error) => {
        reject(new Error(`请求 Apple 服务器失败: ${error.message}`));
      });

      appleReq.write(payload);
      appleReq.end();
    });

    console.log('[Apple Pay] 商户验证成功');
    
    // 返回 merchant session 给前端
    res.json(merchantSession);

  } catch (error) {
    console.error('[Apple Pay] 商户验证失败:', error.message);
    res.status(500).json({
      error: 'Merchant Validation Failed',
      message: error.message
    });
  }
});

/**
 * 支付授权接口
 * 用户确认支付后，前端调用此接口提交支付 token
 */
app.post('/process-payment', (req, res) => {
  try {
    const { payment, transactionConfig } = req.body;

    if (!payment || !payment.token) {
      return res.status(400).json({
        error: 'Missing Payment Data',
        message: '请提供支付数据'
      });
    }

    console.log('[Apple Pay] 收到支付请求');
    console.log('[Apple Pay] 支付 Token:', JSON.stringify(payment.token, null, 2));
    
    // 记录交易配置（如果提供）
    if (transactionConfig) {
      console.log('[Apple Pay] 交易配置:', JSON.stringify(transactionConfig, null, 2));
    }

    // ===========================================
    // 这里是你处理支付 token 的地方
    // 
    // 1. 如果你只需要拿到 token 不解密：
    //    - 直接将 token 发送给你的支付处理商（如 Stripe、Adyen 等）
    //    - 或者保存 token 供后续处理
    //
    // 2. 如果你需要自己解密 token：
    //    - 需要配置 Payment Processing Certificate
    //    - 使用证书解密 payment.token.paymentData
    //
    // 示例：仅记录 token
    // ===========================================
    
    // TODO: 在这里集成你的支付处理逻辑
    // 可以使用 transactionConfig 中的信息：
    // - transactionConfig.countryCode: 国家/地区代码
    // - transactionConfig.currencyCode: 币种代码
    // - transactionConfig.merchantMCC: 商户 MCC 代码
    // - transactionConfig.merchantName: 商户名称
    // - transactionConfig.amount: 支付金额
    
    // 模拟成功响应
    res.json({
      success: true,
      message: '支付 token 已接收',
      token: payment.token,
      transactionConfig: transactionConfig || null,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Apple Pay] 支付处理失败:', error.message);
    res.status(500).json({
      error: 'Payment Processing Failed',
      message: error.message
    });
  }
});

/**
 * 健康检查接口
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Apple Pay Demo Server',
    timestamp: new Date().toISOString()
  });
});

/**
 * 配置检查接口
 * 用于验证服务器配置是否正确
 */
app.get('/config-check', (req, res) => {
  // 检查证书是否存在（支持文件或 Base64）
  const certAvailable = CERT_CONFIG.certBase64 || fs.existsSync(CERT_CONFIG.certPath);
  const keyAvailable = CERT_CONFIG.keyBase64 || fs.existsSync(CERT_CONFIG.keyPath);
  
  const checks = {
    merchantIdentifier: APPLE_PAY_CONFIG.merchantIdentifier,
    domainName: APPLE_PAY_CONFIG.domainName,
    displayName: APPLE_PAY_CONFIG.displayName,
    certExists: certAvailable,
    keyExists: keyAvailable,
    certSource: CERT_CONFIG.certBase64 ? 'base64' : 'file',
    keySource: CERT_CONFIG.keyBase64 ? 'base64' : 'file',
    caExists: CERT_CONFIG.caPath ? fs.existsSync(CERT_CONFIG.caPath) : null
  };

  const allReady = certAvailable && keyAvailable;

  res.json({
    ready: allReady,
    checks: checks,
    message: allReady 
      ? '配置检查通过，可以开始测试 Apple Pay' 
      : '配置不完整，请检查证书文件是否存在'
  });
});

// ==================== 服务器启动 ====================

// 检测是否在 Railway 环境（Railway 自动提供 HTTPS）
const IS_RAILWAY = process.env.RAILWAY_ENVIRONMENT === 'production' || process.env.RAILWAY_STATIC_URL !== undefined;

if (IS_RAILWAY) {
  // Railway 环境：使用 HTTP，Railway 会自动处理 HTTPS
  app.listen(PORT, () => {
    console.log(`
========================================
  Apple Pay Demo Server 已启动 (Railway)
========================================
  PORT: ${PORT}
  配置检查: /config-check
  健康检查: /health
  
  重要提示：
  1. 请在 Railway Dashboard 设置环境变量
  2. 确保证书内容已通过环境变量注入
  3. 配置自定义域名并验证
========================================
    `);
  });
} else {
  // 本地或其他环境：尝试使用 HTTPS
  // HTTPS 配置
  // 注意：Apple Pay 要求必须使用 HTTPS
  let serverOptions;
  try {
    // 尝试读取 HTTPS 证书（生产环境）
    const cert = fs.readFileSync(process.env.SSL_CERT_PATH || './certs/server.crt');
    const key = fs.readFileSync(process.env.SSL_KEY_PATH || './certs/server.key');
    
    serverOptions = { cert, key };
    console.log('[Server] 使用自定义 HTTPS 证书');
  } catch (err) {
    // 如果没有证书，使用自签名证书（仅用于开发测试）
    console.log('[Server] 未找到 HTTPS 证书，将使用自签名证书（仅用于开发测试）');
    console.log('[Server] 生产环境请配置有效的 SSL 证书');
    
    // 生成自签名证书（仅开发用）
    const selfsigned = require('crypto').generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    
    // 使用 node-forge 或 openssl 生成自签名证书比较复杂
    // 这里提示用户使用 mkcert 或其他工具
    console.log('[Server] 请使用以下命令生成自签名证书用于开发：');
    console.log('  npx mkcert create-cert --validity 365 --key certs/server.key --cert certs/server.crt');
    console.log('  或者使用 OpenSSL:');
    console.log('  openssl req -x509 -newkey rsa:4096 -keyout certs/server.key -out certs/server.crt -days 365 -nodes');
    
    // 如果没有证书，尝试启动 HTTP 服务器（仅用于本地测试，Apple Pay 需要 HTTPS）
    console.log('[Server] 警告：Apple Pay 要求 HTTPS，HTTP 模式下 Apple Pay 将无法正常工作');
  }

  // 启动服务器
  if (serverOptions) {
    https.createServer(serverOptions, app).listen(PORT, () => {
      console.log(`
========================================
  Apple Pay Demo Server 已启动
========================================
  HTTPS: https://localhost:${PORT}
  配置检查: https://localhost:${PORT}/config-check
  健康检查: https://localhost:${PORT}/health
  
  重要提示：
  1. 请将商户证书放入 ./certs/ 目录
  2. 更新 server.js 中的 APPLE_PAY_CONFIG 配置
  3. 确保域名验证文件已放置在 public/.well-known/ 目录
  4. 使用真实域名和有效 SSL 证书进行测试
========================================
      `);
    });
  } else {
    // 开发模式：HTTP（Apple Pay 不会工作，仅用于测试其他功能）
    app.listen(3000, () => {
      console.log(`
========================================
  Apple Pay Demo Server (HTTP 模式)
========================================
  HTTP: http://localhost:3000
  
  ⚠️  警告：当前为 HTTP 模式，Apple Pay 无法使用！
  
  Apple Pay 要求：
  1. 必须使用 HTTPS
  2. 必须使用有效域名（非 localhost）
  3. 域名必须在 Apple Developer 后台验证通过
  
  请配置 SSL 证书后使用 HTTPS 启动服务器
========================================
      `);
    });
  }
}
