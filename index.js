const express = require('express');
const cheerio = require('cheerio');
const axios = require('axios');
const xml2js = require('xml2js');
const playwright = require('playwright');
const path = require('path');

const app = express();

app.use(express.json());
app.use(express.static('public'));
app.use('/screenshots', express.static('screenshots')); // Serve screenshots directory
app.use(express.urlencoded({ extended: true }));

// Serve the HTML form
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Website Crawler</title>
            <style>
                body { 
                    font-family: Arial, sans-serif; 
                    max-width: 1200px; 
                    margin: 0 auto; 
                    padding: 20px; 
                }
                .container { 
                    margin-top: 20px; 
                }
                #urlInput { 
                    width: 70%; 
                    padding: 10px; 
                    margin-bottom: 10px; 
                }
                #submitBtn { 
                    padding: 10px 20px; 
                    background: #4CAF50; 
                    color: white; 
                    border: none; 
                    cursor: pointer; 
                }
                #submitBtn:disabled {
                    background: #cccccc;
                    cursor: not-allowed;
                }
                #results { 
                    margin-top: 20px;
                }
                .error { 
                    color: red; 
                }
                .loading {
                    text-align: center;
                    padding: 20px;
                    font-style: italic;
                }
                .grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                    gap: 20px;
                    margin-top: 20px;
                }
                .card {
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    overflow: hidden;
                    background: white;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .card-image {
                    width: 100%;
                    height: 200px;
                    object-fit: cover;
                    border-bottom: 1px solid #eee;
                }
                .card-content {
                    padding: 15px;
                }
                .card-link {
                    color: #0066cc;
                    text-decoration: none;
                    word-break: break-all;
                    font-size: 14px;
                }
                .card-link:hover {
                    text-decoration: underline;
                }
                .stats {
                    margin-bottom: 20px;
                    padding: 10px;
                    background: #f5f5f5;
                    border-radius: 4px;
                }
            </style>
        </head>
        <body>
            <h1>Website Crawler</h1>
            <div class="container">
                <input type="text" id="urlInput" placeholder="Enter website URL (e.g., https://example.com)">
                <button id="submitBtn">Start Crawling</button>
                <div id="results"></div>
            </div>
            <script>
                const urlInput = document.getElementById('urlInput');
                const submitBtn = document.getElementById('submitBtn');
                const results = document.getElementById('results');

                submitBtn.addEventListener('click', async () => {
                    const url = urlInput.value.trim();
                    if (!url) {
                        results.innerHTML = '<p class="error">Please enter a URL</p>';
                        return;
                    }

                    try {
                        submitBtn.disabled = true;
                        results.innerHTML = '<div class="loading">Crawling website and taking screenshots...<br>This may take a few minutes depending on the number of pages.</div>';

                        const response = await fetch('/crawl', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url })
                        });

                        const data = await response.json();
                        
                        // Display results in a grid layout
                        let html = \`
                            <div class="stats">
                                Total pages found: \${data.results.length}
                            </div>
                            <div class="grid">\`;

                        data.results.forEach(result => {
                            html += \`
                                <div class="card">
                                    <img 
                                        class="card-image" 
                                        src="/screenshots/\${result.screenshot}" 
                                        alt="Screenshot of \${result.url}"
                                        onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'300\\' height=\\'200\\' viewBox=\\'0 0 300 200\\'%3E%3Crect width=\\'300\\' height=\\'200\\' fill=\\'%23eee\\'/%3E%3Ctext x=\\'50%25\\' y=\\'50%25\\' text-anchor=\\'middle\\' fill=\\'%23999\\' font-family=\\'Arial\\' font-size=\\'16\\'%3EScreenshot failed to load%3C/text%3E%3C/svg%3E'"
                                    >
                                    <div class="card-content">
                                        <a href="\${result.url}" target="_blank" class="card-link">\${result.url}</a>
                                    </div>
                                </div>
                            \`;
                        });

                        html += '</div>';
                        results.innerHTML = html;
                    } catch (error) {
                        results.innerHTML = '<p class="error">Error: ' + error.message + '</p>';
                    } finally {
                        submitBtn.disabled = false;
                    }
                });
            </script>
        </body>
        </html>
    `);
});

// Helper function to filter unwanted links
function isValidPageLink(href) {
    const nonPageExtensions = [
        '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp',
        '.mp4', '.mp3', '.avi', '.mov', '.wmv', '.zip', '.rar', 
        '.exe', '.dmg', '.css', '.js', '.json', '.xml', '.csv', 
        '.xlsx', '.doc', '.docx', '.ppt', '.pptx', '.ico'
    ];

    // Exclude empty links, JavaScript links, and fragment links
    if (!href || href.startsWith('#') || href.startsWith('javascript:void(0)')) {
        return false;
    }

    // Exclude links containing fragments (e.g., '#section')
    if (href.includes('#')) {
        return false;
    }

    // Check for non-page extensions
    if (nonPageExtensions.some(ext => href.toLowerCase().includes(ext))) {
        return false;
    }

    return true;
}

// Helper function to fetch sitemap links
async function fetchSitemap(baseUrl) {
    const sitemapLinks = new Set();
    try {
        const response = await axios.get(`${baseUrl}/sitemap.xml`);
        const parsedXml = await xml2js.parseStringPromise(response.data);
        const urlSet = parsedXml?.urlset?.url || [];
        for (const urlObj of urlSet) {
            if (urlObj?.loc) sitemapLinks.add(urlObj.loc[0]);
        }

        const sitemapIndex = parsedXml?.sitemapindex?.sitemap || [];
        for (const sitemap of sitemapIndex) {
            const loc = sitemap?.loc[0];
            if (loc) {
                try {
                    const nestedResponse = await axios.get(loc);
                    const nestedXml = await xml2js.parseStringPromise(nestedResponse.data);
                    const nestedUrls = nestedXml?.urlset?.url || [];
                    for (const nestedUrl of nestedUrls) {
                        if (nestedUrl?.loc) sitemapLinks.add(nestedUrl.loc[0]);
                    }
                } catch {
                    console.error(`Failed to fetch nested sitemap: ${loc}`);
                }
            }
        }
    } catch (error) {
        console.error(`Failed to fetch sitemap: ${error.message}`);
    }
    return Array.from(sitemapLinks);
}

// Helper function for HTML link extraction
async function crawlHTML(baseUrl, startUrl, visitedLinks) {
    const htmlLinks = new Set();

    async function crawlPage(url) {
        if (visitedLinks.has(url)) return;
        visitedLinks.add(url);

        try {
            const response = await axios.get(url);
            const $ = cheerio.load(response.data);

            $('a').each((_, element) => {
                const href = $(element).attr('href');
                if (isValidPageLink(href)) {
                    const absoluteUrl = new URL(href, baseUrl).href;
                    if (absoluteUrl.startsWith(baseUrl)) {
                        htmlLinks.add(absoluteUrl);
                    }
                }
            });
        } catch (error) {
            console.error(`Error fetching page: ${url}, ${error.message}`);
        }
    }

    await crawlPage(startUrl);
    return Array.from(htmlLinks);
}


// Function to take a full-page screenshot with error handling
const takeScreenshot = async (url, filename) => {
    let browser;
    let page;
    try {
        // Launch the browser
        console.log(`Launching browser for URL: ${url}`);
        browser = await playwright.chromium.launch({ headless: true });
        const context = await browser.newContext();
        page = await context.newPage();

        // Navigate to the URL and wait for the page to load
        console.log(`Navigating to ${url}`);
        await page.goto(url, { waitUntil: 'networkidle' });

        // Take a full-page screenshot
        const screenshotPath = path.join(__dirname, 'screenshots', `${filename}.png`);
        console.log(`Taking screenshot for ${url}`);

        await page.screenshot({ path: screenshotPath, fullPage: true });

        // Check if the file is saved
        if (fs.existsSync(screenshotPath)) {
            console.log(`Screenshot saved at ${screenshotPath}`);
        } else {
            throw new Error('Screenshot file was not saved correctly');
        }

        // Return the path to the screenshot
        return screenshotPath;

    } catch (error) {
        console.error(`Error during screenshot process for URL: ${url}`);
        console.error(`Error message: ${error.message}`);

        // Graceful error message if URL couldn't be opened or screenshot couldn't be taken
        if (page) {
            console.error(`Failed to navigate or take screenshot for URL: ${url}`);
        }

        // Return null to indicate failure
        return null;
    } finally {
        // Ensure the browser is always closed, even in case of an error
        if (browser) {
            await browser.close();
            console.log('Browser closed');
        }
    }
};

module.exports = takeScreenshot;



// Modified crawl endpoint
app.post('/crawl', async (req, res) => {
    const { url } = req.body;
    const baseUrl = new URL(url).origin;

    // Extract links from HTML and Sitemap
    const visitedLinks = new Set();
    const htmlLinks = await crawlHTML(baseUrl, url, visitedLinks);
    const sitemapLinks = await fetchSitemap(baseUrl);

    // Combine and deduplicate all discovered links
    const allLinks = Array.from(new Set([...htmlLinks, ...sitemapLinks]));

    // Take screenshots and create result objects
    const results = [];
    for (let i = 0; i < allLinks.length; i++) {
        const link = allLinks[i];
        const screenshotFilename = `screenshot-${i}.png`;
        await takeScreenshot(link, `screenshot-${i}`);
        
        results.push({
            url: link,
            screenshot: screenshotFilename
        });
    }

    // Respond with the results array containing both links and screenshot paths
    res.json({ results, message: "Crawl completed successfully" });
});

// Start Server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
