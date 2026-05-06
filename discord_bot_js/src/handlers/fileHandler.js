const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const SAFE_EXTENSIONS = new Set([
  ".py", ".js", ".ts", ".tsx", ".jsx", ".cs", ".java",
  ".cpp", ".c", ".h", ".json", ".yaml", ".yml", ".md",
  ".txt", ".html", ".css", ".sql", ".sh", ".conf", ".env"
]);

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const INTAKE_DIR = path.join(__dirname, "../../intake");

function validateAttachment(attachment) {
  if (!attachment || !attachment.name) {
    return { valid: false, reason: "No filename", extension: "" };
  }

  const ext = path.extname(attachment.name).toLowerCase();
  
  if (!SAFE_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      reason: "Extension not allowed",
      extension: ext
    };
  }

  if (attachment.size && attachment.size > MAX_ATTACHMENT_BYTES) {
    return {
      valid: false,
      reason: "File too large (max 10 MB)",
      extension: ext
    };
  }

  return { valid: true, extension: ext };
}

function downloadFromUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error("HTTP " + res.statusCode));
        return;
      }

      const chunks = [];
      let size = 0;

      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_ATTACHMENT_BYTES) {
          res.destroy();
          reject(new Error("Size exceeded"));
          return;
        }
        chunks.push(chunk);
      });

      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function downloadAttachment(attachment) {
  try {
    const content = await downloadFromUrl(attachment.url);
    return { content, size: content.length };
  } catch (err) {
    throw new Error("Download failed: " + err.message);
  }
}

function sanitizeFilename(filename) {
  let safe = filename.replace(/[\\/]/g, "");
  safe = safe.replace(/^\\.+/, "");
  safe = safe.replace(/[<>:"|?*\\x00-\\x1f]/g, "_");
  if (Buffer.byteLength(safe, "utf8") > 255) {
    safe = safe.substring(0, 200);
  }
  return safe || "file";
}

function storeFileMetadata(guildId, channelId, messageId, authorId, filename, content) {
  const messageDir = path.join(INTAKE_DIR, guildId, channelId, messageId);
  const filesDir = path.join(messageDir, "files");
  
  if (!fs.existsSync(filesDir)) {
    fs.mkdirSync(filesDir, { recursive: true });
  }

  const sanitized = sanitizeFilename(filename);
  const filePath = path.join(filesDir, sanitized);
  const ext = path.extname(filename).toLowerCase();

  fs.writeFileSync(filePath, content);

  const metadata = {
    authorId,
    guildId,
    channelId,
    messageId,
    originalFilename: filename,
    sanitizedFilename: sanitized,
    size: content.length,
    extension: ext,
    timestamp: new Date().toISOString(),
    filePath: filePath.replace(/^.*intake/, "intake"),
    lines: content.toString("utf8").split("\\n").length
  };

  const metadataPath = path.join(messageDir, "metadata.json");
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  return metadata;
}

function summarizeFile(filename, content) {
  const text = typeof content === "string" ? content : content.toString("utf8");
  const lines = text.split("\\n");
  const ext = path.extname(filename).toLowerCase();
  
  const preview = [];
  let charCount = 0;
  
  for (const line of lines.slice(0, 10)) {
    if (charCount + line.length > 500) break;
    if (line.trim()) {
      preview.push(line);
      charCount += line.length;
    }
  }

  return {
    filename,
    extension: ext,
    size: Buffer.byteLength(text, "utf8"),
    lines: lines.length,
    preview: preview.slice(0, 5).join("\\n"),
    hasPreview: preview.length > 0
  };
}

module.exports = {
  validateAttachment,
  downloadAttachment,
  sanitizeFilename,
  storeFileMetadata,
  summarizeFile,
  SAFE_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  INTAKE_DIR
};

// Attachment type classification
const CODE_EXTENSIONS = new Set([
  ".py", ".js", ".ts", ".tsx", ".jsx", ".cs", ".java",
  ".cpp", ".c", ".h", ".json", ".yaml", ".yml", ".md",
  ".txt", ".html", ".css", ".sql", ".sh", ".conf", ".env"
]);

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"
]);

const ARCHIVE_EXTENSIONS = new Set([
  ".zip", ".tar", ".gz", ".7z", ".rar"
]);

function classifyAttachment(attachment) {
  if (!attachment || !attachment.name) {
    return { category: "unsupported", valid: false, reason: "No filename" };
  }

  const ext = path.extname(attachment.name).toLowerCase();
  
  if (IMAGE_EXTENSIONS.has(ext)) {
    return {
      category: "image",
      valid: true,
      extension: ext,
      contentType: attachment.contentType || "image/*"
    };
  }
  
  if (CODE_EXTENSIONS.has(ext)) {
    if (attachment.size && attachment.size > MAX_ATTACHMENT_BYTES) {
      return {
        category: "code_text",
        valid: false,
        reason: "File too large (max 10 MB)",
        extension: ext
      };
    }
    return {
      category: "code_text",
      valid: true,
      extension: ext
    };
  }
  
  if (ARCHIVE_EXTENSIONS.has(ext)) {
    return {
      category: "archive",
      valid: false,
      reason: "Archives need workspace processing",
      extension: ext
    };
  }
  
  return {
    category: "unsupported",
    valid: false,
    reason: "Unsupported file type",
    extension: ext
  };
}

module.exports = {
  validateAttachment,
  downloadAttachment,
  sanitizeFilename,
  storeFileMetadata,
  summarizeFile,
  classifyAttachment,
  CODE_EXTENSIONS,
  IMAGE_EXTENSIONS,
  ARCHIVE_EXTENSIONS,
  SAFE_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  INTAKE_DIR
};
