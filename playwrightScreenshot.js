const playwright = require('playwright');

// Function to take full-page screenshot
const takeScreenshot = async (url) => {
    try {
        // Launching browser
        const browser = await playwright.chromium.launch();
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle' });
        
        // Taking full-page screenshot
        const screenshotPath = `screenshots/${new URL(url).hostname}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await browser.close();
        
        return screenshotPath;
    } catch (error) {
        console.error(`Failed to take screenshot of ${url}:`, error);
        return null;
    }
};

module.exports = takeScreenshot;
