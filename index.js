// import express from 'express';
//import * as cheerio from 'cheerio';
//import axios from 'axios';
const express = require('express');
const cheerio = require('cheerio');
const axios = require('axios');
const xml2js = require('xml2js');

const app = express();

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
                #results { margin-top: 20px; white-space: pre-wrap; }
                .error { color: red; }
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
                        results.innerHTML = '<p>Crawling, please wait...</p>';

                        const response = await fetch('/crawl', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url })
                        });

                        const data = await response.json();
                        const linksList = data.uniqueLinks.map(link => '- ' + link).join('\\n');
                        results.innerHTML = 
                            '<h3>Unique Links Found:</h3>' +
                            '<pre>' + linksList + '</pre>' +
                            '<p>Total Unique Links: ' + data.uniqueLinks.length + '</p>';
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

// Main Crawling Endpoint
app.post('/crawl', async (req, res) => {
    const { url } = req.body;
    const baseUrl = new URL(url).origin;

    const visitedLinks = new Set();
    const htmlLinks = await crawlHTML(baseUrl, url, visitedLinks);
    const sitemapLinks = await fetchSitemap(baseUrl);

    const allLinks = new Set([...htmlLinks, ...sitemapLinks]);
    res.json({ uniqueLinks: Array.from(allLinks) });
});

// Start Server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
