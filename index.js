const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { TempMail } = require('temp-mail-node');
const cors = require('cors');

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

let jobQueue = [];
let isBusy = false;

async function launchBrowser() {
    return puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox', '--disable-setuid-sandbox',
            '--disable-web-security', '--disable-features=VizDisplayCompositor',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
            '--window-size=1920,1080'
        ]
    });
}

// Unitool Specific Flow
async function generateUnitoolImage(prompt) {
    const browser = await launchBrowser();
    const page = await browser.newPage();
    
    try {
        // 1. Go to Unitool Midjourney
        await page.goto('https://unitool.ai/en/midjourney', { 
            waitUntil: 'domcontentloaded', 
            timeout: 60000 
        });
        
        // 2. Temp mail signup (no login needed for guest)
        const mail = new TempMail();
        const emailData = await mail.getNewMail();
        const tempEmail = emailData.address;
        
        // 3. Guest mode - direct chat
        await page.waitForSelector('textarea[placeholder*="prompt"], textarea[data-testid="chat-input"], .prompt-input', { timeout: 15000 });
        
        // 4. Type MJ prompt with params
        const fullPrompt = `${prompt} --ar 16:9 --v 7 --stylize 750 --q 2`;
        await page.type('textarea[placeholder*="prompt"], textarea[data-testid="chat-input"], .prompt-input', fullPrompt);
        
        // 5. Send (from network logs)
        await page.click('button[type="submit"], button:has(svg), [data-testid="send-message"], .send-btn');
        
        // 6. Wait for generation (job pending -> completed)
        console.log('⏳ Waiting for generation...');
        await page.waitForSelector('.generated-image, [data-testid="job-completed"], img[src*="cloudflarestorage"]', { timeout: 180000 });
        
        // 7. Extract R2 Cloudflare image URLs
        await page.waitForTimeout(5000); // Let all images load
        const images = await page.evaluate(() => {
            const imgs = Array.from(document.querySelectorAll('img'))
                .filter(img => img.src.includes('cloudflarestorage.com') || img.src.includes('r2'))
                .map(img => ({
                    url: img.src,
                    alt: img.alt || 'MJ Image'
                }));
            return imgs.slice(0, 4);
        });
        
        // 8. Validate download links
        const directLinks = [];
        for (let img of images) {
            try {
                const resp = await page.evaluate(async (url) => {
                    const response = await fetch(url, { method: 'HEAD' });
                    return response.ok ? url : null;
                }, img.url);
                if (resp) directLinks.push(resp);
            } catch {
                directLinks.push(img.url);
            }
        }
        
        await browser.close();
        return { 
            success: true, 
            images: directLinks, 
            prompt: fullPrompt,
            count: directLinks.length
        };
        
    } catch (error) {
        await browser.close();
        console.error('❌ Unitool Error:', error.message);
        throw error;
    }
}

// 🚀 Main API Endpoint
app.post('/imagine', async (req, res) => {
    const { prompt = 'beautiful cat portrait' } = req.body;
    
    console.log(`🎨 New request: ${prompt}`);
    
    if (isBusy) {
        jobQueue.push({ prompt, res });
        return res.json({ 
            queued: true, 
            position: jobQueue.length,
            message: 'Processing in queue...' 
        });
    }
    
    isBusy = true;
    try {
        const result = await generateUnitoolImage(prompt);
        res.json(result);
    } catch (error) {
        res.status(500).json({ 
            error: error.message,
            retry: true 
        });
    } finally {
        isBusy = false;
        processNextJob();
    }
});

// Queue Handler
async function processNextJob() {
    if (jobQueue.length > 0 && !isBusy) {
        const { prompt, res } = jobQueue.shift();
        isBusy = true;
        try {
            const result = await generateUnitoolImage(prompt);
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        } finally {
            isBusy = false;
            processNextJob();
        }
    }
}

// Status API
app.get('/status', (req, res) => {
    res.json({ 
        running: true,
        busy: isBusy, 
        queue: jobQueue.length,
        uptime: process.uptime()
    });
});

const PORT = process.env.PORT || 4000;
app.liste
