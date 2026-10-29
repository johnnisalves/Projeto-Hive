import { Router } from 'express';
import { z } from 'zod';
import { login, register, refresh, googleConfig, googleLogin } from '../controllers/auth.controller';
import { validate } from '../middleware/validate';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().optional(),
});

router.post('/login', validate(loginSchema), login);
router.post('/register', validate(registerSchema), register);
router.post('/refresh', refresh);
router.get('/google/config', googleConfig);
router.post('/google', validate(z.object({ credential: z.string().min(20) })), googleLogin);

export default router;
