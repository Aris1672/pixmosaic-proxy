const https = require("https");
const http = require("http");
const { parseStringPromise } = require("xml2js");

const XML_URL =
  "https://pixmosaic.ru/bitrix/catalog_export/export_Lo9.xml";

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
    .replace(/\u00A0/g, " ") // non-breaking space
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value, { fallback = null, logKey = "" } = {}) {
  if (value === undefined || value === null) return fallback;

  const raw = String(value);

  const cleaned = raw
    .replace(/\u00A0/g, "")   // remove NBSP
    .replace(",", ".")        // normalize decimal
    .replace(/[^\d.\-]/g, "") // strip garbage
    .trim();

  const num = Number(cleaned);

  if (isNaN(num)) {
    console.warn(`⚠️ Invalid number for ${logKey}:`, JSON.stringify(raw));
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
    const key = cleanString(p.name);
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
      trim: true, // 🔥 important
    });

    const shop = parsed?.yml_catalog?.shop;
    if (!shop) throw new Error("Invalid XML structure: missing shop");

    const rawOffers = shop?.offers?.offer;
    if (!rawOffers) throw new Error("No offers found");

    const offers = Array.isArray(rawOffers) ? rawOffers : [rawOffers];

    const products = offers.map((offer) => {
      const params = extractParams(offer.param);

      const stockRaw = params["Доступное количество"];

      const stock = parseNumber(stockRaw, {
        fallback: 0,
        logKey: `stock (offer ${offer.id})`,
      });

      // 🔍 Debug only problematic cases
      if (offer.id === "872") {
        console.log("DEBUG 872 STOCK RAW:", JSON.stringify(stockRaw));
        console.log("DEBUG 872 STOCK PARSED:", stock);
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

        article: cleanString(params["Артикул"]),
        material: cleanString(params["Материал"]),
        surface: cleanString(params["Поверхность"]),
        base: cleanString(params["Основа"]),

        module_size: cleanString(params["Размер модуля (мм)"]),
        chip_size: cleanString(params["Размер чипа (мм)"]),
        thickness_mm: parseNumber(params["Толщина (мм)"], {
          fallback: null,
          logKey: "thickness",
        }),

        module_area_m2: parseNumber(params["Площадь модуля (м2)"], {
          fallback: null,
          logKey: "module_area",
        }),

        pack_qty_m2: parseNumber(params["Количество в упаковке (м2)"], {
          fallback: null,
          logKey: "pack_m2",
        }),

        pack_qty_pcs: parseNumber(
          params["Количиество в упаковке (шт)"],
          {
            fallback: null,
            logKey: "pack_pcs",
          }
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
