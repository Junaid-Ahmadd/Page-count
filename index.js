import express from 'express';
import * as cheerio from 'cheerio';
import axios from 'axios';

const app = express();

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Serve the HTML form
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Website Crawler</title>
            <style>
                body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
                .container { margin-top: 20px; }
                #urlInput { width: 100%; padding: 10px; margin-bottom: 10px; }
                #submitBtn { padding: 10px 20px; background: #4CAF50; color: white; border: none; cursor: pointer; }
                #submitBtn:disabled { background: #cccccc; }
                #results { margin-top: 20px; white-space: pre-wrap; }
                .error { color: red; }
                .loading { color: #666; }
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
                        results.innerHTML = '<p class="loading">Crawling website, please wait...</p>';

                        const response = await fetch('/crawl', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url })
                        });

                        const data = await response.json();

                        if (data.error) {
                            results.innerHTML = '<p class="error">Error: ' + data.error + '</p>';
                        } else {
                            const linksList = data.links.map(link => '- ' + link).join('\\n');
                            results.innerHTML = 
                                '<h3>Results:</h3>' +
                                '<p>Total pages found: ' + data.links.length + '</p>' +
                                '<pre>' + linksList + '</pre>';
                        }
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

// Crawling endpoint
app.post('/crawl', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        // Validate URL format
        try {
            new URL(url);
        } catch (error) {
            return res.status(400).json({ error: 'Invalid URL format' });
        }

        const visited = new Set();
        const links = new Set();
        const baseUrl = new URL(url).origin;

        let homePageVisited = false; // Flag to track if the home page has been visited

        // Helper function to filter out obvious non-page links
        function isPageLink(href) {
            const nonPageExtensions = [
                '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp',
                '.mp4', '.mp3', '.avi', '.mov', '.wmv', '.zip', '.rar', 
                '.exe', '.dmg', '.css', '.js', '.json', '.xml', '.csv', 
                '.xlsx', '.doc', '.docx', '.ppt', '.pptx', '.ico'
            ];

            // Exclude empty links, JavaScript void links, and links starting with '#'
            if (!href || href.startsWith('#') || href.startsWith('javascript:void(0)')) {
                return false;
            }

            // Exclude links containing fragments (e.g., '#respond', '#section')
            if (href.includes('#')) {
                return false;
            }

            // Exclude links with paths like '/cdn-cgi/' or email protection links
            if (href.includes('/cdn-cgi/') || href.includes('/l/email-protection')) {
                return false;
            }

            // Check if the URL has any non-page extensions
            if (nonPageExtensions.some(ext => href.toLowerCase().includes(ext))) {
                return false;
            }

            return true;
        }

        // Crawl function
        async function crawlPage(pageUrl) {
            // Skip if the page is already visited or if we've reached the link limit
            if (visited.has(pageUrl) || links.size >= 100) {
                return;
            }

            console.log(`Crawling: ${pageUrl}`);
            visited.add(pageUrl);

            try {
                const response = await axios.get(pageUrl, { 
                    timeout: 100000,
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    maxRedirects: 0,  // Disable automatic following of redirects
                    validateStatus: status => status < 400 || status === 302 // Accept 302 redirects
                });

                // Check if the page was redirected (301 or 302 status) to the home page
                const finalUrl = response.request.res.responseUrl || pageUrl;

                // If the page is the home page and we already visited it, skip
                if (finalUrl === baseUrl || finalUrl === `${baseUrl}/`) {
                    if (homePageVisited) {
                        console.log(`Skipping already visited home page: ${finalUrl}`);
                        return;
                    }
                    homePageVisited = true;  // Mark home page as visited
                }

                // If the page is redirected to the home page, we skip it
                if (finalUrl.startsWith(baseUrl) && finalUrl !== pageUrl) {
                    console.log(`Skipping redirected link to home page: ${finalUrl}`);
                    return;
                }

                const $ = cheerio.load(response.data);

                $('a').each((i, element) => {
                    let href = $(element).attr('href');
                    if (!href) return;

                    try {
                        const absoluteUrl = new URL(href, baseUrl).href;
                        // Only include URLs from the same domain and valid page links
                        if (absoluteUrl.startsWith(baseUrl) && isPageLink(absoluteUrl)) {
                            links.add(absoluteUrl);
                        }

                    } catch (error) {
                        console.error(`Invalid URL found: ${href}, Error: ${error.message}`);
                    }
                });

                // Wait a bit to avoid overwhelming the server
                await new Promise(resolve => setTimeout(resolve, 1000));

            } catch (error) {
                // Handle redirects (301/302), skip these URLs
                if (error.response && (error.response.status === 301 || error.response.status === 302)) {
                    console.log(`Detected redirect for ${pageUrl}, skipping.`);
                } else {
                    console.error(`Error crawling ${pageUrl}: ${error.message}`);
                }
            }
        }

        // Start crawling from the initial URL
        await crawlPage(url);

        // Crawl discovered links
        const promises = Array.from(links).map(link => crawlPage(link));
        await Promise.all(promises);

        res.json({ links: Array.from(links) });

    } catch (error) {
        console.error('Crawling error:', error);
        res.status(500).json({ error: 'Failed to crawl website' });
    }
});


// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
