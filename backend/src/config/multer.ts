import multer from "multer";
import path from "path";
import fs from "fs";

const uploadRoot = path.join(process.cwd(), "uploads", "driver-documents");

const ALLOWED_MIMES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
];
const ALLOWED_EXT = [".pdf", ".jpg", ".jpeg", ".png"];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function createDriverDocumentsUpload(driverId: string) {
  const dir = path.join(uploadRoot, driverId);
  ensureDir(uploadRoot);
  ensureDir(dir);

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDir(dir);
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const timestamp = Date.now();
      const ext = path.extname(file.originalname) || "";
      const base = path.basename(file.originalname, ext).replace(/\s+/g, "_");
      cb(null, `${timestamp}-${base}${ext.toLowerCase()}`);
    },
  });

  const fileFilter: multer.Options["fileFilter"] = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ALLOWED_MIMES.includes(file.mimetype) || ALLOWED_EXT.includes(ext);
    if (allowed) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, JPG and PNG files are allowed"));
    }
  };

  return multer({
    storage,
    fileFilter,
    limits: { fileSize: MAX_SIZE },
  });
}

export const driverDocumentsUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const dir = path.join(uploadRoot, id ?? "");
      ensureDir(uploadRoot);
      ensureDir(dir);
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const timestamp = Date.now();
      const ext = path.extname(file.originalname) || "";
      const base = path.basename(file.originalname, ext).replace(/\s+/g, "_");
      cb(null, `${timestamp}-${base}${ext.toLowerCase()}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ALLOWED_MIMES.includes(file.mimetype) || ALLOWED_EXT.includes(ext);
    if (allowed) cb(null, true);
    else cb(new Error("Only PDF, JPG and PNG files are allowed"));
  },
  limits: { fileSize: MAX_SIZE },
});
