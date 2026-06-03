const crypto = require('crypto');

// Token de acesso do usuário (Fallback seguro para testes imediatos)
const FALLBACK_TOKEN = 'EAAOHZAMoMAMABRiDdwDfD9dt10nLuTlDWRoXwh6AJsjk7eOqoWEJO1sLJL99aWAsUyDZAus5ZAcwJQFXVZBynT1tdzZAsglTVD0ar8TAgnNfL2k2rDqApGiOZBce1aE07vTiYZCAiRro8QINnANnocxLaZB8gPl8GgxBf4LgdYEEHiOUYLylDPZA8KUZBdYSCc3Bs9cwZDZD';
const PIXEL_ID = '1710890780056459';

// Função para gerar Hash SHA-256 conforme especificações da Meta
function sha256(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

// Normaliza o telefone brasileiro para conter DDI (55) + DDD + Número sem caracteres especiais
function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/\D/g, ''); // Apenas dígitos
  
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }
  
  // Se tiver 10 ou 11 dígitos (ex: 48998084284) e não iniciar com 55, adiciona 55 no início
  if (!cleaned.startsWith('55') && (cleaned.length === 10 || cleaned.length === 11)) {
    cleaned = '55' + cleaned;
  }
  return cleaned;
}

// Divide o nome completo para extrair o Primeiro Nome (fn) e Sobrenome (ln)
function parseName(fullName) {
  if (!fullName) return { fn: null, ln: null };
  const parts = fullName.trim().split(/\s+/);
  const fn = parts[0].toLowerCase();
  const ln = parts.slice(1).join(' ').toLowerCase();
  return { fn, ln: ln || null };
}

module.exports = async (req, res) => {
  // Configurar cabeçalhos CORS básicos se necessário
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Utilize POST.' });
  }

  try {
    const { nome, tel, email, interesse, eventId, fbp, fbc, eventUrl, test_event_code } = req.body;

    if (!nome || !tel || !email) {
      return res.status(400).json({ error: 'Campos nome, tel e email são obrigatórios.' });
    }

    // 1. Normalização e Criptografia
    const normalizedPhone = normalizePhone(tel);
    const { fn, ln } = parseName(nome);

    const emailHash = sha256(email);
    const phoneHash = normalizedPhone ? sha256(normalizedPhone) : null;
    const firstNameHash = fn ? sha256(fn) : null;
    const lastNameHash = ln ? sha256(ln) : null;

    // 2. Coleta de Metadados do Cliente
    const clientIp = req.headers['x-forwarded-for']
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // 3. Montagem do Objeto User Data
    const userData = {};
    if (emailHash) userData.em = [emailHash];
    if (phoneHash) userData.ph = [phoneHash];
    if (firstNameHash) userData.fn = [firstNameHash];
    if (lastNameHash) userData.ln = [lastNameHash];
    if (clientIp) userData.client_ip_address = clientIp;
    if (userAgent) userData.client_user_agent = userAgent;
    if (fbp) userData.fbp = fbp;
    if (fbc) userData.fbc = fbc;

    // 4. Montagem do Payload do Evento
    const eventPayload = {
      event_name: 'Lead',
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId || `lead_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      event_source: 'website',
      action_source: 'website',
      event_url: eventUrl || 'https://terra-jurere-wellness.vercel.app/',
      user_data: userData,
      custom_data: {
        content_name: 'Terra Jurere Wellness — Lead',
        content_category: interesse || 'não informado'
      }
    };

    const token = process.env.META_CONVERSIONS_API_TOKEN || FALLBACK_TOKEN;
    const apiVersion = 'v20.0';
    const url = `https://graph.facebook.com/${apiVersion}/${PIXEL_ID}/events`;

    const requestBody = {
      data: [eventPayload]
    };

    // Adiciona código de teste se enviado pelo cliente
    if (test_event_code) {
      requestBody.test_event_code = test_event_code;
    }

    // 5. Envio da Requisição para a Graph API da Meta
    const metaResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    const responseData = await metaResponse.json();

    if (!metaResponse.ok) {
      console.error('Erro na resposta do Facebook Graph API:', responseData);
      return res.status(metaResponse.status).json({
        success: false,
        error: 'Erro retornado pela Meta API',
        details: responseData
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Evento enviado com sucesso para a API de Conversões da Meta.',
      meta_response: responseData
    });

  } catch (error) {
    console.error('Erro interno ao processar Conversions API:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
