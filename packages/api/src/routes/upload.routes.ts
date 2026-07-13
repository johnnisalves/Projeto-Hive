import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth.middleware';
import {
  uploadImageController,
  uploadMultipleImagesController,
  uploadFileController,
  uploadVideoController,
} from '../controllers/upload.controller';

const router = Router();
// Limites aumentados: fotos de celular/alta resolucao passam de 10MB facil.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const uploadFile = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const uploadVideo = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

router.use(authMiddleware);
router.post('/', upload.single('image'), uploadImageController);
router.post('/multiple', upload.array('images', 10), uploadMultipleImagesController);
router.post('/file', uploadFile.single('file'), uploadFileController);
router.post('/video', uploadVideo.single('video'), uploadVideoController);

// Tratamento de erro do multer (ex: arquivo grande) -> 400 com mensagem clara.
// Antes: multer chamava next(err) e caia no handler generico -> 500 HTML feio.
router.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ success: false, error: 'Arquivo muito grande. Imagens ate 25MB, arquivos ate 50MB, videos ate 200MB. Reduza o tamanho e tente de novo.' });
      return;
    }
    res.status(400).json({ success: false, error: `Erro no upload: ${err.message}` });
    return;
  }
  if (err) {
    res.status(500).json({ success: false, error: 'Falha no upload' });
    return;
  }
  next();
});

export default router;
