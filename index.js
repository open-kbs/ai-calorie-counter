const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const https = require("https");

const reset = "\x1b[0m";
const bold = "\x1b[1m";
const red = "\x1b[31m";
const yellow = "\x1b[33m";
const green = "\x1b[32m";

console.red = (data) => console.log(`${red}${data}${reset}`);
console.green = (data) => console.log(`${green}${bold}${data}${reset}`);
console.yellow = (data) => console.log(`${yellow}${bold}${data}${reset}`);

const settingsPath = path.join(__dirname, 'app', 'settings.json');
const clientJWTPath = path.join(os.homedir(), '.openkbs', 'clientJWT');

async function printRunning() {
    const figlet = (await import('figlet')).default;
    const chalk = (await import('chalk')).default;
    console.green('\n');
    const asciiArt = await generateAsciiArt('OpenKBS', figlet);
    console.log(chalk.blue(asciiArt));
    console.log(chalk.blue(`                              OpenKBS UI`));
}

const generateAsciiArt = async (text, figlet) => {
    return new Promise((resolve, reject) => {
        figlet(text, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
};

function readSettings() {
    return new Promise((resolve, reject) => {
        fs.readFile(settingsPath, 'utf8', (err, data) => {
            if (err) {
                return reject('Error reading settings file: ' + err);
            }

            try {
                const settings = JSON.parse(data);
                const kbId = settings.kbId;

                if (kbId) {
                    resolve(kbId);
                } else {
                    reject('kbId not found in settings file. Try "openkbs push" first');
                    console.yellow('Use "openkbs push" to create remote KB');
                }
            } catch (parseErr) {
                reject('Error parsing settings file: ' + parseErr);
            }
        });
    });
}

function makePostRequest(url, data) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: 443,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => {
                body += chunk;
            });
            res.on('end', () => {
                if (res.statusCode === 401) {
                    console.red('It appears you are not logged in.');
                    console.yellow('Use "openkbs login" to log in.');
                }

                if (res.statusCode >= 200 && res.statusCode < 300) {
                    const data = JSON.parse(body);
                    resolve(data);
                } else {
                    try {
                        if (JSON.parse(body).error) {
                            console.red(JSON.parse(body).error);
                        } else {
                            console.red(`Invalid Request`);
                        }
                    } catch (e) {
                        console.red(`Invalid Request`);
                    } finally {
                        reject();
                    }
                }
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        req.write(JSON.stringify(data));
        req.end();
    });
}

const AUTH_API_URL = 'https://auth.openkbs.com/';

async function fetchKBJWT(kbId) {
    const token = await readClientJWT();
    try {
        return await makePostRequest(AUTH_API_URL + 'fetchKBJWT', { token, kbId });
    } catch (error) {
        console.error('Unable to fetch KB JWT');
    }
}

function readClientJWT() {
    return new Promise((resolve, reject) => {
        fs.readFile(clientJWTPath, 'utf8', (err, data) => {
            if (err) {
                return reject('Error reading clientJWT file: ' + err);
            }
            resolve(data.trim());
        });
    });
}

function startServer(command, cwd) {
    return new Promise((resolve, reject) => {
        const serverProcess = exec(command, { cwd }, (err) => {
            if (err) {
                return reject('Error starting server: ' + err);
            }
        });

        serverProcess.stdout.on('data', (data) => {
            if (data.toString()?.startsWith(' HTTP')) return; // strip HTTP requests from the output
            console.log(data.toString());
        });

        serverProcess.stderr.on('data', (data) => {
            console.error(data.toString());
        });

        resolve();
    });
}

function waitForServer(url) {
    return new Promise((resolve) => {
        const interval = setInterval(() => {
            http.get(url, (res) => {
                if (res.statusCode === 200) {
                    clearInterval(interval);
                    resolve();
                }
            }).on('error', () => {
                // Server not yet available
            });
        }, 1000);
    });
}

function openBrowser(url) {
    const start = (process.platform == 'darwin' ? 'open' :
        process.platform == 'win32' ? 'start' : 'xdg-open');
    exec(start + ' ' + url);
}

async function main() {
    try {
        await printRunning(); // Call the printRunning function here

        const kbId = await readSettings();

        let kbToken;
        try {
            const res = await fetchKBJWT(kbId);
            kbToken = res.kbToken;
        } catch (e) {
            console.log("Local session expired");
        }

        const url = kbToken
            ? `http://${kbId}.apps.localhost:38593?kbToken=${kbToken}`
            : `http://${kbId}.apps.localhost:38593`;

        await Promise.all([
            startServer(process?.env?.DEV ? 'npm run dev' : 'npm start', path.join(__dirname, 'node_modules', 'openkbs-ui')),
            startServer('webpack serve --config webpack.contentRender.config.js', __dirname)
        ]);

        await waitForServer('http://localhost:38593');
        openBrowser(url);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

main();