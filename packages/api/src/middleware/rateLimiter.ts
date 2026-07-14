import rateLimit from 'express-rate-limit';

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 100 : 5000,
  message: { success: false, error: 'Too many requests, try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  // Endpoints de polling da conexao WhatsApp por QR (autenticados, baixo risco):
  // ficam de fora do limite global para nao quebrar a deteccao ao vivo do modal.
  skip: (req) => /^\/api\/whatsapp\/connections\/[^/]+\/(qr|status)$/.test(req.path),
});
