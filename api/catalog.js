const https = require("https");
const http = require("http");
const { parseStringPromise } = require("xml2js");

const XML_URL = "https://pixmosaic.ru/bitrix/catalog_export/export_Lo9.xml";

// ---------- FETCH ----------
function fetchXML(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, { headers: { "Accept-Encoding": "identity" } }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

// ---------- HELPERS ----------
function cleanString(value) {
  if (value === undefined || value === null) return null;
  return String(value)
    .replace(/\u00A0/g, " ") // replace non-breaking space
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalizes keys to prevent "Ghost" character issues (Cyrillic vs Latin 'o', etc.)
 * and handles whitespace inconsistencies.
 */
function normalizeKey(key) {
  if (!key) return "";
  return key
    .toLowerCase()
    .replace(/\u00A0/g, " ") 
    .trim();
}

function parseNumber(value, { fallback = null, logKey = "" } = {}) {
  if (value === undefined || value === null || value === "") return fallback;

  let raw = String(value).replace(/\u00A0/g, "").trim();

  // Handle European/Russian formats where dot might be a thousands separator 
  // and comma is a decimal, or vice versa.
  if (raw.includes('.') && raw.includes(',')) {
    // If both exist, assume comma is decimal (common in RU)
    raw = raw.replace(/\./g, '').replace(',', '.');
  } else {
    // Otherwise, just swap comma to dot
    raw = raw.replace(',', '.');
  }

  const cleaned = raw.replace(/[^\d.\-]/g, "");
  const num = Number(cleaned);

  if (isNaN(num)) {
    console.warn(`⚠️ Invalid number for ${logKey}:`, JSON.stringify(value));
    return fallback;
  }

  return num;
}

function toBoolean(value) {
  return String(value).toLowerCase() === "true";
}

function normalizeParamValue(p) {
  return cleanString(p._ ?? p);
}

function extractParams(paramField) {
  const params = {};
  if (!paramField) return params;

  const list = Array.isArray(paramField) ? paramField : [paramField];

  list.forEach((p) => {
    // Normalize the key so we don't miss it due to encoding or typos
    const key = normalizeKey(p.name);
    const value = normalizeParamValue(p);
    if (key) params[key] = value;
  });

  return params;
}

// ---------- MAIN ----------
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const xml = await fetchXML(XML_URL);

    const parsed = await parseStringPromise(xml, {
      explicitArray: false,
      mergeAttrs: true,
      trim: true,
    });

    const shop = parsed?.yml_catalog?.shop;
    if (!shop) throw new Error("Invalid XML structure: missing shop");

    const rawOffers = shop?.offers?.offer;
    if (!rawOffers) throw new Error("No offers found");

    const offers = Array.isArray(rawOffers) ? rawOffers : [rawOffers];

    const products = offers.map((offer) => {
      const params = extractParams(offer.param);

      // Using the normalized lowercase key to find stock
      const stockKey = "доступное количество";
      const stockRaw = params[stockKey];

      const stock = parseNumber(stockRaw, {
        fallback: 0,
        logKey: `stock (offer ${offer.id})`,
      });

      // Debugging PIX 305 specifically
      if (offer.id === "872") {
        console.log("--- DEBUG 872 ---");
        console.log("Raw params keys:", Object.keys(params));
        console.log("Found stock raw:", JSON.stringify(stockRaw));
        console.log("Parsed stock:", stock);
      }

      return {
        id: cleanString(offer.id),
        available: toBoolean(offer.available),
        url: cleanString(offer.url),
        price: parseNumber(offer.price, { fallback: 0, logKey: "price" }),
        currency: cleanString(offer.currencyId),
        category_id: cleanString(offer.categoryId),
        picture: cleanString(offer.picture),
        model: cleanString(offer.model),
        description: cleanString(offer.description),

        // Mapping using normalized lowercase keys
        article: cleanString(params["артикул"]),
        material: cleanString(params["материал"]),
        surface: cleanString(params["поверхность"]),
        base: cleanString(params["основа"]),
        module_size: cleanString(params["размер модуля (мм)"]),
        chip_size: cleanString(params["размер чипа (мм)"]),
        
        thickness_mm: parseNumber(params["толщина (мм)"], { fallback: null }),
        module_area_m2: parseNumber(params["площадь модуля (м2)"], { fallback: null }),
        pack_qty_m2: parseNumber(params["количество в упаковке (м2)"], { fallback: null }),
        
        // Handling the specific typo in your XML: "Количиество"
        pack_qty_pcs: parseNumber(
          params["количиество в упаковке (шт)"] || params["количество в упаковке (шт)"],
          { fallback: null }
        ),

        stock_m2: stock,
      };
    });

    return res.status(200).json({
      success: true,
      total: products.length,
      updated: shop?.$?.date || null,
      products,
    });
  } catch (err) {
    console.error("❌ Parser error:", err);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};
