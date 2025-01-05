const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const fetch = require('node-fetch');
const cron = require('node-cron');
const fs = require('fs');
require('dotenv').config();
require('events').setMaxListeners(20); // set max event listerners to 20 to see if it has to do with the "memory leak"

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const videoDataFile = 'videos.json'; // json file for video ids
let lastVideos = [];
let notifiedVideos = new Set();
let isCheckingVideo = false;

// api key array
const apiKeys = [
    process.env.YOUTUBE_API_KEY_1,
    process.env.YOUTUBE_API_KEY_2,
    process.env.YOUTUBE_API_KEY_3,
    process.env.YOUTUBE_API_KEY_4,
    process.env.YOUTUBE_API_KEY_5,
    process.env.YOUTUBE_API_KEY_6
];
let apiKeyIndex = 0;

// load saved video ids and timestamps on start
function loadVideoData() {
    if (fs.existsSync(videoDataFile)) {
        const data = JSON.parse(fs.readFileSync(videoDataFile, 'utf-8'));
        lastVideos = data.videoIds || [];
    } else {
        lastVideos = [];
    }
}

// save only the last 5 video ids and timestamps
function saveVideoData() {
    fs.writeFileSync(
        videoDataFile,
        JSON.stringify({ videoIds: lastVideos.slice(-5) }, null, 2),
        'utf-8'
    );
}

// get next api key
function getNextApiKey() {
    const key = apiKeys[apiKeyIndex];
    apiKeyIndex = (apiKeyIndex + 1) % apiKeys.length;
    return key;
}

// fetch with retries and better api key rotation
async function fetchWithRetries(url) {
    let retries = 0;
    while (retries < apiKeys.length) {
        const apiKey = getNextApiKey();
        const fullUrl = `${url}&key=${apiKey}`;
        try {
            const response = await fetch(fullUrl);
            const data = await response.json();
            if (data.error) {
                console.error(`API Key Error (${apiKey}):`, data.error.message);
                retries++;
            } else {
                return data;
            }
        } catch (error) {
            console.error(`Fetch error with API key (${apiKey}):`, error);
            retries++;
        }
    }
    console.error('All API keys failed.');
    return null;
}

// check for new videos
async function checkNewVideo() {
    if (isCheckingVideo) return; // prevent overlap
    isCheckingVideo = true;

    try {
        const channelId = process.env.YOUTUBE_CHANNEL_ID;
        const url = `https://www.googleapis.com/youtube/v3/search?channelId=${channelId}&part=snippet,id&order=date&maxResults=5`;

        const data = await fetchWithRetries(url);
        if (!data || !data.items || data.items.length === 0) {
            console.error('Invalid or empty response from YouTube API.');
            return;
        }

        // filter only video items
        const validVideos = data.items.filter(item => item.id.kind === 'youtube#video');
        const newVideos = validVideos.map(video => ({
            id: video.id.videoId,
            publishedAt: video.snippet.publishedAt
        }));

        // check for new unseen videos with valid timestamps
        const unseenVideos = newVideos.filter(video => {
            const isNew = !lastVideos.some(v => v.id === video.id);
            const isLater = !lastVideos.length || new Date(video.publishedAt) > new Date(lastVideos[lastVideos.length - 1].publishedAt);
            return isNew && isLater;
        });

        if (unseenVideos.length > 0) {
            for (const video of unseenVideos.reverse()) {
                notifyDiscord(video.id);
                lastVideos.push(video); // add to the buffer
            }
            // keep only the last 5 videos in memory
            lastVideos = lastVideos.slice(-5);
            saveVideoData(); // save updated video list
        } else {
            console.log('No new videos found.');
        }
    } catch (error) {
        console.error('Error checking for new videos:', error);
    } finally {
        isCheckingVideo = false;
    }
}

// send notifications to discord
function notifyDiscord(videoId) {
    if (notifiedVideos.has(videoId)) return; // prevent duplicate notifications

    const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
    if (channel) {
        channel.send(`Hey @everyone, AceOfCreation just posted a new video! 🎥 Check it out:
https://www.youtube.com/watch?v=${videoId}`);
        console.log(`Notified about video: ${videoId}`);
        notifiedVideos.add(videoId);
        setTimeout(() => notifiedVideos.delete(videoId), 86400000); // remove from notified set after 24 hours
    } else {
        console.error('Discord channel not found.');
    }
}

// start bot or login client tf if i care its 02:31
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
    loadVideoData();

    client.user.setActivity({ name: 'AceOfCreation', type:ActivityType.Listening}); // set status first on startup

    // set status at 12 midnight because otherwise it somehow stops working
    cron.schedule('0 0 0 * * *', () => {
        client.user.setActivity({
            name: 'AceOfCreation',
            type: ActivityType.Listening,
        });
    });

    cron.schedule('*/3 * * * *', checkNewVideo);
});

// test api keys on startup
async function testApiKeys() {
    console.log('Testing API keys...');
    for (const apiKey of apiKeys) {
        try {
            const testUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=1&key=${apiKey}`;
            const response = await fetch(testUrl);
            const data = await response.json();
            if (data.error) {
                console.error(`API Key Test Failed (${apiKey}): ${data.error.message}`);
            } else {
                console.log(`API Key Working: ${apiKey}`);
            }
        } catch (error) {
            console.error(`Error testing API key (${apiKey}):`, error);
        }
    }
}

testApiKeys();
client.login(process.env.DISCORD_TOKEN);
