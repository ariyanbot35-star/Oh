import express from "express";
import puppeteer from "puppeteer";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 8080;

// =======================
// Global State
// =======================
let browser = null;
let queue = [];
let isProcessing = false;

// =======================
// Utils
// =======================
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// -----------------------
// Launch Browser
// -----------------------
async function getBrowser() {
  if (browser) return browser;

  console.log("🚀 Launching browser...");

  browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  });

  console.log("✅ Browser ready");
  return browser;
}

// -----------------------
// Cookies
// -----------------------
async function loadCookies(page) {
  if (!fs.existsSync("cookies.json")) return;
  const cookies = JSON.parse(fs.readFileSync("cookies.json", "utf8"));
  if (cookies.length) {
    await page.setCookie(...cookies);
    console.log("🍪 Cookies loaded");
  }
}

async function saveCookies(page) {
  const cookies = await page.cookies();
  fs.writeFileSync("cookies.json", JSON.stringify(cookies, null, 2));
  console.log("💾 Cookies saved");
}

// -----------------------
// DOM Helpers
// -----------------------
async function clickByText(page, text) {
  await page.evaluate((t) => {
    const els = Array.from(document.querySelectorAll("button, div, span"));
    const target = els.find(e =>
      e.innerText && e.innerText.toLowerCase().includes(t.toLowerCase())
    );
    if (target) target.click();
  }, text);
}

async function clearAndType(page, selector, value) {
  await page.waitForSelector(selector, { timeout: 60000 });
  await page.click(selector);
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.type(selector, value, { delay: 25 });
}

// =======================
// Core Automation Logic
// =======================
async function generateImage(prompt, retries = 2) {
  let page;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
    );

    // Open Unitool
    await page.goto("https://unitool.ai/", {
      waitUntil: "networkidle2",
      timeout: 60000
    });

    // Load cookies
    await loadCookies(page);
    await page.reload({ waitUntil: "networkidle2" });
    await wait(4000);

    // Select Midjourney
    console.log("🎯 Selecting Midjourney...");
    await clickByText(page, "midjourney");
    await wait(3000);

    // Input prompt
    const promptSelector = "textarea, input[type='text']";
    await clearAndType(page, promptSelector, prompt);

    // Click Generate / Imagine
    console.log("🚀 Clicking Generate...");
    await clickByText(page, "generate");
    await clickByText(page, "imagine");

    // Wait for result
    console.log("🎨 Waiting for image...");
    await wait(25000);

    const imageUrl = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll("img"));
      const valid = imgs.find(i =>
        i.src &&
        i.src.startsWith("http") &&
        !i.src.includes("avatar") &&
        !i.src.includes("logo")
      );
      return valid ? valid.src : null;
    });

    await saveCookies(page);
    await page.close();

    if (!imageUrl) {
      throw new Error("Image not detected");
    }

    return { success: true, image: imageUrl };

  } catch (err) {
    if (page) await page.close();
    console.warn("⚠️ Generation failed:", err.message);

    if (retries > 0) {
      console.log("🔁 Retrying...");
      await wait(5000);
      return generateImage(prompt, retries - 1);
    }

    return { success: false, error: err.message };
  }
}

// =======================
// Queue Processor
// =======================
async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;

  while (queue.length) {
    const job = queue.shift();
    const result = await generateImage(job.prompt);
    job.resolve(result);
  }

  isProcessing = false;
}

// =======================
// API
// =======================
app.get("/", (req, res) => {
  res.send("✅ Unitool Midjourney Automation API (Fly.io)");
});

app.get("/generate", async (req, res) => {
  const prompt = req.query.prompt;
  if (!prompt) {
    return res.json({ status: false, error: "prompt query missing" });
  }

  const jobPromise = new Promise((resolve) => {
    queue.push({ prompt, resolve });
  });

  processQueue();

  const result = await jobPromise;

  if (!result.success) {
    return res.json({
      status: false,
      error: result.error
    });
  }

  res.json({
    status: true,
    engine: "unitool-midjourney",
    prompt,
    image: result.image
  });
});

app.listen(PORT, () => {
  console.log("🚀 API running on port", PORT);
});
