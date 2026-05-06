const ALLOWED_CODE_EXTENSIONS = new Set([
  ".py", ".js", ".ts", ".tsx", ".jsx", ".cs", ".java",
  ".cpp", ".c", ".h", ".json", ".yaml", ".yml", ".md",
  ".txt", ".html", ".css", ".sql", ".sh", ".conf", ".env"
]);

const SMALL_FILE_KEYWORDS = [
  "file", "python", ".py", ".js", ".json", "yaml", "config",
  "readme", "script", "function", "starter", "template",
  "simple", "basic", "example", "hello"
];

const HEAVY_CODING_KEYWORDS = [
  "website", "full", "entire", "app", "application",
  "project", "repo", "repository", "multiple", "build",
  "debug", "test", "react", "dotnet", "angular", "vue",
  "full-stack", "microservice"
];

const MAX_GENERATED_FILE_BYTES = Number(
  process.env.DISCORD_CODE_ATTACHMENT_MAX_BYTES || 131072
);

const ALLOW_HEAVY_CODING = String(
  process.env.DISCORD_ALLOW_HEAVY_CODING || "false"
).toLowerCase() === "true";

const ALLOW_CODE_ATTACHMENTS = String(
  process.env.DISCORD_ALLOW_CODE_ATTACHMENTS || "true"
).toLowerCase() === "true";

function classifyDiscordCodeIntent(text) {
  const lower = text.toLowerCase();
  const words = lower.split(/\\s+/);

  let smallFileScore = 0;
  let heavyCodingScore = 0;

  for (const word of words) {
    for (const keyword of SMALL_FILE_KEYWORDS) {
      if (word.includes(keyword)) {
        smallFileScore += 1;
      }
    }
    for (const keyword of HEAVY_CODING_KEYWORDS) {
      if (word.includes(keyword)) {
        heavyCodingScore += 1;
      }
    }
  }

  const isCodeRelated = smallFileScore > 0 || heavyCodingScore > 0;
  const isSmallFileRequest = smallFileScore >= 2 && heavyCodingScore === 0;
  const isHeavyCodingRequest = heavyCodingScore >= 2;

  let suggestedTemplate = null;
  let language = null;

  if (isSmallFileRequest) {
    if (lower.includes("python") || lower.includes(".py")) {
      suggestedTemplate = lower.includes("hello") ? "python_hello" : "python_function";
      language = "python";
    } else if (lower.includes("readme")) {
      suggestedTemplate = "readme";
      language = "markdown";
    } else if (lower.includes("config") && lower.includes("json")) {
      suggestedTemplate = "config_json";
      language = "json";
    } else if (lower.includes("config") && (lower.includes("yaml") || lower.includes(".yml"))) {
      suggestedTemplate = "config_yaml";
      language = "yaml";
    } else if (lower.includes("js") || lower.includes("javascript")) {
      suggestedTemplate = "js_starter";
      language = "javascript";
    } else if (lower.includes("bash") || lower.includes(".sh")) {
      suggestedTemplate = "bash_script";
      language = "bash";
    } else {
      suggestedTemplate = "python_function";
      language = "python";
    }
  }

  let suggestedFilename = null;
  if (suggestedTemplate === "python_hello") {
    suggestedFilename = "hello_world.py";
  } else if (suggestedTemplate === "python_function") {
    suggestedFilename = "example.py";
  } else if (suggestedTemplate === "readme") {
    suggestedFilename = "README.md";
  } else if (suggestedTemplate === "config_json") {
    suggestedFilename = "config.json";
  } else if (suggestedTemplate === "config_yaml") {
    suggestedFilename = "config.yaml";
  } else if (suggestedTemplate === "js_starter") {
    suggestedFilename = "index.js";
  } else if (suggestedTemplate === "bash_script") {
    suggestedFilename = "script.sh";
  }

  return {
    isCodeRelated,
    isSmallFileRequest,
    isHeavyCodingRequest,
    suggestedTemplate,
    suggestedFilename,
    language,
    smallFileScore,
    heavyCodingScore
  };
}

function sanitizeCodeFilename(name, fallback = "zero_two_snippet.txt") {
  if (!name || typeof name !== "string") {
    return fallback;
  }

  let safe = name.replace(/[\\/]/g, "");
  safe = safe.replace(/^\\.+/, "");
  safe = safe.replace(/[<>:"|?*\\x00-\\x1f]/g, "");

  if (Buffer.byteLength(safe, "utf8") > 255) {
    safe = safe.substring(0, 100);
  }

  return safe || fallback;
}

function isAllowedCodeExtension(filename) {
  if (!filename || typeof filename !== "string") {
    return false;
  }

  const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
  return ALLOWED_CODE_EXTENSIONS.has(ext);
}

function getAllowedExtensions() {
  return Array.from(ALLOWED_CODE_EXTENSIONS);
}

module.exports = {
  classifyDiscordCodeIntent,
  sanitizeCodeFilename,
  isAllowedCodeExtension,
  getAllowedExtensions,
  ALLOWED_CODE_EXTENSIONS,
  MAX_GENERATED_FILE_BYTES,
  ALLOW_HEAVY_CODING,
  ALLOW_CODE_ATTACHMENTS
};
