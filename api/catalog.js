const https = require("https");
const http = require("http");
const { parseStringPromise } = require("xml2js");

const XML_URL =
  "https://pixmosaic.ru/bitrix/catalog_export/export_Lo9.xml";

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

module.exports = async (req, res) => {
  // CORS headers so Voiceflow can call this
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
    });

    const shop = parsed.yml_catalog.shop;
    const rawOffers = shop.offers.offer;
    const offers = Array.isArray(rawOffers) ? rawOffers : [rawOffers];

    const products = offers.map((offer) => {
      // Extract params into a flat object
      const params = {};
      if (offer.param) {
        const paramList = Array.isArray(offer.param)
          ? offer.param
          : [offer.param];
        paramList.forEach((p) => {
          params[p.name] = p._ || p;
        });
      }

      return {
        id: offer.id,
        available: offer.available === "true",
        url: offer.url,
        price: parseInt(offer.price, 10),
        currency: offer.currencyId,
        category_id: offer.categoryId,
        picture: offer.picture,
        model: offer.model,
        description: offer.description,
        article: params["Артикул"] || null,
        material: params["Материал"] || null,
        surface: params["Поверхность"] || null,
        module_size: params["Размер модуля (мм)"] || null,
        chip_size: params["Размер чипа (мм)"] || null,
        thickness_mm: params["Толщина (мм)"] || null,
        module_area_m2: params["Площадь модуля (м2)"] || null,
        pack_qty_m2: params["Количество в упаковке (м2)"] || null,
        pack_qty_pcs: params["Количиество в упаковке (шт)"] || null,
        stock_m2: parseFloat(String(params["Доступное количество"] || "0").replace(",", ".")) || 0,
        base: params["Основа"] || null,
      };
    });

    return res.status(200).json({
      success: true,
      total: products.length,
      updated: shop["$"] ? shop["$"].date : null,
      products,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};
