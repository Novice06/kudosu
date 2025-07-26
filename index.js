import express from "express";
import puppeteer from "puppeteer";
import * as dotenv from "dotenv";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
app.use(express.json());

// Configuration
const COOKIE_FILE = 'cookies_inferior.json';
const MAX_SOLVED_PER_SESSION = 1000;
const GAME_URL = "https://sudoku.lumitelburundi.com/game";
const BASE_URL = "https://sudoku.lumitelburundi.com";
const BOT_ID = "INFERIOR";
const OTHER_BOT_URL = "https://num66-kudosu.onrender.com"; // URL du bot supérieur

// Variables d'état
let currentBrowser = null;
let currentPage = null;
let waitingForPhone = false;
let waitingForOTP = false;
let phoneNumber = '';
let otpCode = '';
let isProcessing = false;
let solvedCount = 0;
let currentGridValues = null;
let isWaitingForPartner = false;
let hasCompletedHalf = false;

// Chemins
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fonction pour communiquer avec l'autre bot
async function communicateWithPartner(endpoint, data = {}) {
    try {
        const response = await fetch(`${OTHER_BOT_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...data, from: BOT_ID })
        });
        return await response.json();
    } catch (error) {
        console.log(`❌ Erreur communication avec partenaire: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// Routes
app.get("/", (req, res) => {
    res.json({
        message: "Sudoku Solver BOT INFERIOR API is running",
        botId: BOT_ID,
        endpoints: {
            start: "/start-sudoku - POST - Démarre le processus de résolution",
            phone: "/submit-phone - POST - Soumet le numéro de téléphone",
            otp: "/submit-otp - POST - Soumet le code OTP",
            status: "/status - GET - Vérifie le statut du processus",
            "partner-status": "/partner-status - POST - Endpoint pour la communication entre bots",
            "share-grid": "/share-grid - POST - Partage la grille avec le partenaire",
            "notify-completion": "/notify-completion - POST - Notifie la completion de la moitié"
        }
    });
});

app.get("/status", (req, res) => {
    res.json({
        botId: BOT_ID,
        isProcessing,
        waitingForPhone,
        waitingForOTP,
        hasBrowser: !!currentBrowser,
        hasPage: !!currentPage,
        solvedCount,
        maxPerSession: MAX_SOLVED_PER_SESSION,
        isWaitingForPartner,
        hasCompletedHalf
    });
});

// Endpoint pour recevoir le statut du partenaire
app.post("/partner-status", (req, res) => {
    const { isProcessing: partnerProcessing, from } = req.body;
    console.log(`📡 Statut reçu du ${from}: ${partnerProcessing ? 'En marche' : 'Arrêté'}`);
    res.json({ success: true, myStatus: isProcessing, botId: BOT_ID });
});

// Endpoint pour recevoir la grille du partenaire
app.post("/share-grid", (req, res) => {
    const { gridValues, from } = req.body;
    console.log(`📡 Grille reçue du ${from}`);
    currentGridValues = gridValues;
    res.json({ success: true, botId: BOT_ID });
});

// Endpoint pour recevoir la notification de completion
app.post("/notify-completion", (req, res) => {
    const { completed, from } = req.body;
    console.log(`📡 Notification du ${from}: ${completed ? 'Terminé' : 'En cours'}`);
    if (completed && hasCompletedHalf) {
        console.log("🎉 Les deux moitiés sont terminées! Rechargement de la page...");
        setTimeout(async () => {
            await reloadGamePage();
            hasCompletedHalf = false;
            isWaitingForPartner = false;
        }, 2000);
    }
    res.json({ success: true, botId: BOT_ID });
});

app.post("/start-sudoku", async (req, res) => {
    if (isProcessing) {
        return res.status(400).json({
            success: false,
            error: "Le processus est déjà en cours"
        });
    }

    try {
        isProcessing = true;
        solvedCount = 0;
        console.log(`🚀 Démarrage du solveur Sudoku ${BOT_ID}...`);
        
        solveSudokuProcess().catch(error => {
            console.error("Erreur dans le processus:", error);
            isProcessing = false;
        });

        res.json({
            success: true,
            message: `Processus de résolution ${BOT_ID} démarré`
        });
    } catch (error) {
        isProcessing = false;
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post("/submit-phone", async (req, res) => {
    const { phone } = req.body;
    
    if (!waitingForPhone) {
        return res.status(400).json({
            success: false,
            error: "Aucune demande de numéro en cours"
        });
    }

    if (!phone) {
        return res.status(400).json({
            success: false,
            error: "Numéro de téléphone requis"
        });
    }

    phoneNumber = phone;
    waitingForPhone = false;
    
    res.json({
        success: true,
        message: "Numéro de téléphone reçu"
    });
});

app.post("/submit-otp", async (req, res) => {
    const { otp } = req.body;
    
    if (!waitingForOTP) {
        return res.status(400).json({
            success: false,
            error: "Aucune demande d'OTP en cours"
        });
    }

    if (!otp) {
        return res.status(400).json({
            success: false,
            error: "Code OTP requis"
        });
    }

    otpCode = otp;
    waitingForOTP = false;
    
    res.json({
        success: true,
        message: "Code OTP reçu"
    });
});

// Gestion des cookies
async function saveCookies(page) {
    try {
        const cookies = await page.cookies();
        fs.writeFileSync(path.join(__dirname, COOKIE_FILE), JSON.stringify(cookies, null, 2));
        console.log('🍪 Cookies sauvegardés');
    } catch (error) {
        console.error('Erreur sauvegarde cookies:', error.message);
    }
}

async function loadCookies(page) {
    try {
        const cookiePath = path.join(__dirname, COOKIE_FILE);
        if (fs.existsSync(cookiePath)) {
            const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
            await page.setCookie(...cookies);
            console.log('🍪 Cookies chargés');
            return true;
        }
        return false;
    } catch (error) {
        console.error('Erreur chargement cookies:', error.message);
        return false;
    }
}

// Fonctions utilitaires
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function initBrowser() {
    return await puppeteer.launch({
        args: [
            "--disable-setuid-sandbox",
            "--no-sandbox",
            "--single-process",
            "--no-zygote",
            "--disable-dev-shm-usage"
        ],
        executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome-stable",
        headless: "new",
        timeout: 60000
    });
}

async function initPage(browser) {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.setViewport({ width: 1280, height: 720 });
    return page;
}

// Algorithme de résolution de Sudoku
function isSafe(board, row, col, num) {
    for (let d = 0; d < board.length; d++) {
        if (board[row][d] === num) return false;
    }

    for (let r = 0; r < board.length; r++) {
        if (board[r][col] === num) return false;
    }

    const sqrt = Math.floor(Math.sqrt(board.length));
    const boxRowStart = row - row % sqrt;
    const boxColStart = col - col % sqrt;

    for (let r = boxRowStart; r < boxRowStart + sqrt; r++) {
        for (let d = boxColStart; d < boxColStart + sqrt; d++) {
            if (board[r][d] === num) return false;
        }
    }

    return true;
}

function solveSudoku(board) {
    const n = board.length;
    let row = -1;
    let col = -1;
    let isEmpty = true;
    
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            if (board[i][j] === 0) {
                row = i;
                col = j;
                isEmpty = false;
                break;
            }
        }
        if (!isEmpty) break;
    }

    if (isEmpty) return true;

    for (let num = 1; num <= n; num++) {
        if (isSafe(board, row, col, num)) {
            board[row][col] = num;
            if (solveSudoku(board)) return true;
            else board[row][col] = 0;
        }
    }
    return false;
}

function convertTo2D(gridValues) {
    const board = [];
    for (let i = 0; i < 9; i++) {
        board.push(gridValues.slice(i * 9, (i + 1) * 9).map(Number));
    }
    return board;
}

function convertTo1D(board) {
    return board.flat();
}

async function checkPartnerStatus() {
    console.log("🤝 Vérification du statut du partenaire...");
    const response = await communicateWithPartner("/partner-status", { isProcessing: true });
    return response.success;
}

async function waitForPartnerReady() {
    console.log("⏳ Attente que le partenaire soit prêt...");
    let attempts = 0;
    const maxAttempts = 30;
    
    while (attempts < maxAttempts) {
        const isReady = await checkPartnerStatus();
        if (isReady) {
            console.log("✅ Partenaire prêt!");
            return true;
        }
        console.log(`⏳ Tentative ${attempts + 1}/${maxAttempts} - Partenaire pas encore prêt`);
        await sleep(2000);
        attempts++;
    }
    
    console.log("⚠️ Timeout - Continue sans partenaire");
    return false;
}

async function handleLogin(cookiesLoaded = false, maxAttempts = 3) {
    let attempt = 0;
    
    while (attempt < maxAttempts) {
        try {
            console.log(`\nTentative de connexion ${attempt + 1}/${maxAttempts} - ${BOT_ID}`);
            await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
            await sleep(2000);
            
            const currentUrl = currentPage.url();
            if (!currentUrl.includes(GAME_URL)) {
                if (cookiesLoaded) {
                    console.log("Redirection malgré les cookies, ils sont peut-être expirés");
                    cookiesLoaded = false;
                }
                
                console.log("Redirection détectée, démarrage du processus de connexion...");
                
                console.log("Étape 1: Clique sur le bouton Kwinjira");
                await currentPage.waitForSelector("button.w-53.py-3.px-6.bg-gradient-to-r.from-amber-400.to-amber-500.text-white.text-lg.font-bold.rounded-full.shadow-lg.mt-36", { timeout: 30000 });
                await currentPage.click("button.w-53.py-3.px-6.bg-gradient-to-r.from-amber-400.to-amber-500.text-white.text-lg.font-bold.rounded-full.shadow-lg.mt-36");
                await sleep(2000);
                
                await currentPage.waitForFunction(() => window.location.href.includes("/login"));
                
                console.log("Étape 2: Demande du numéro de téléphone");
                await currentPage.waitForSelector("input[placeholder='Nimushiremwo inomero ya terefone']", { timeout: 30000 });
                
                waitingForPhone = true;
                phoneNumber = '';
                console.log(`📱 ${BOT_ID} - En attente du numéro de téléphone via l'API...`);
                
                while (waitingForPhone || !phoneNumber) {
                    await sleep(1000);
                }
                
                await currentPage.type("input[placeholder='Nimushiremwo inomero ya terefone']", phoneNumber);
                await sleep(1000);
                
                await currentPage.click("button.w-full.py-2.bg-red-700.text-white.rounded-md.font-semibold.hover\\:bg-red-600.transition.duration-200");
                await sleep(2000);
                
                console.log("Étape 3: Demande du code OTP");
                await currentPage.waitForSelector("input[placeholder='OTP']", { timeout: 30000 });
                
                waitingForOTP = true;
                otpCode = '';
                console.log(`🔐 ${BOT_ID} - En attente du code OTP via l'API...`);
                
                while (waitingForOTP || !otpCode) {
                    await sleep(1000);
                }
                
                await currentPage.type("input[placeholder='OTP']", otpCode);
                await sleep(1000);
                
                await currentPage.click("button.w-full.py-2.bg-red-700.text-white.rounded-md.font-semibold.hover\\:bg-red-800.transition.duration-200");
                console.log("Attente de 10 secondes...");
                await sleep(10000);
                
                console.log("Navigation vers la page de jeu...");
                await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
                await sleep(3000);
                
                if (!currentPage.url().includes(GAME_URL)) {
                    console.log("La connexion a échoué, nouvelle tentative...");
                    attempt++;
                    continue;
                }
                
                console.log(`${BOT_ID} - Connexion réussie!`);
                return true;
            }
            
            console.log(`${BOT_ID} - Déjà connecté, poursuite du script...`);
            return true;
            
        } catch (error) {
            console.log(`Erreur lors de la tentative de connexion: ${error.message}`);
            attempt++;
            await sleep(5000);
        }
    }
    
    console.log(`Échec après ${maxAttempts} tentatives de connexion`);
    return false;
}

async function getSudokuGrid() {
    try {
        try {
            await currentPage.waitForFunction(() => document.readyState === 'complete', { timeout: 5000 });
        } catch (e) {
            console.log("⚠ La page ne répond pas, tentative de rafraîchissement...");
            await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
            await sleep(3000);
        }

        await currentPage.waitForSelector("div.grid.grid-cols-9.gap-0.border-4.border-black", { 
            timeout: 20000,
            visible: true
        });
        
        const gridValues = await currentPage.evaluate(() => {
            const cells = document.querySelectorAll("div.grid.grid-cols-9.gap-0.border-4.border-black div.w-10.h-10");
            return Array.from(cells).map(cell => cell.textContent.trim());
        });
        
        if (gridValues.length === 81) {
            return gridValues;
        }
        
        console.log("Grille incomplète trouvée (", gridValues.length, "éléments)");
        return null;
    } catch (error) {
        console.error(`Erreur récupération grille: ${error.message}`);
        return null;
    }
}

async function fillLowerHalf(solvedValues) {
    try {
        const cells = await currentPage.$("div.grid.grid-cols-9.gap-0.border-4.border-black div.w-10.h-10");
        const numberButtons = await currentPage.$("div.flex.gap-2.mt-4 button");
        
        // Remplir seulement les 5 dernières lignes (45-80, soit lignes 5-8)
        for (let i = 45; i < 81; i++) {
            const currentValue = await cells[i].evaluate(el => el.textContent.trim());
            const targetValue = solvedValues[i].toString();
            
            if (currentValue === targetValue) continue;
            
            if (!currentValue && targetValue) {
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        const currentVal = await cells[i].evaluate(el => el.textContent.trim());
                        if (currentVal === targetValue) break;
                        
                        if (!currentVal) {
                            await cells[i].click();
                            await sleep(300);
                            
                            const isSelected = await cells[i].evaluate(el => 
                                el.className.includes("bg-blue-200")
                            );
                            
                            if (isSelected && numberButtons[parseInt(targetValue) - 1]) {
                                await numberButtons[parseInt(targetValue) - 1].click();
                                await sleep(500);
                                
                                const newValue = await cells[i].evaluate(el => el.textContent.trim());
                                if (newValue === targetValue) break;
                                
                                console.log(`⚠ Réessai case ${i} (valeur non prise)`);
                                await sleep(1000);
                            }
                        }
                    } catch (error) {
                        console.log(`Erreur case ${i}: ${error.message.substring(0, 50)}`);
                        await sleep(1000);
                    }
                }
            }
        }
        return true;
    } catch (error) {
        console.error(`Erreur remplissage moitié inférieure: ${error.message}`);
        return false;
    }
}

async function reloadGamePage() {
    try {
        console.log("🔄 Rechargement de la page de jeu...");
        await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
        await sleep(3000);
        console.log("✅ Page rechargée avec succès!");
        return true;
    } catch (error) {
        console.error("❌ Erreur lors du rechargement:", error);
        return false;
    }
}

async function solveOneSudoku(roundNumber) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🎯 ${BOT_ID} - ROUND ${roundNumber}`);
    console.log(`${'='.repeat(50)}`);
    
    try {
        console.log("Étape 1: Synchronisation avec le partenaire");
        const partnerReady = await waitForPartnerReady();
        if (!partnerReady) {
            console.log("⚠️ Continue sans synchronisation parfaite");
        }
        
        console.log("Étape 2: Attente de la grille du partenaire");
        // Attendre que le partenaire partage la grille
        let waitTime = 0;
        const maxWaitTime = 30000; // 30 secondes max
        while (!currentGridValues && waitTime < maxWaitTime) {
            await sleep(1000);
            waitTime += 1000;
        }
        
        let gridValues = currentGridValues;
        if (!gridValues) {
            console.log("📡 Pas de grille reçue du partenaire, récupération locale...");
            await currentPage.bringToFront();
            
            gridValues = await getSudokuGrid();
            if (!gridValues) {
                console.log("🔄 Rafraîchissement de la page...");
                await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
                await sleep(3000);
                gridValues = await getSudokuGrid();
                if (!gridValues) return false;
            }
        } else {
            console.log("✅ Grille reçue du partenaire!");
            // Reset pour le prochain tour
            currentGridValues = null;
        }
        
        const numericGrid = gridValues.map(val => val === '' ? 0 : parseInt(val));
        
        console.log("\nÉtape 3: Résolution du Sudoku");
        const board = convertTo2D(numericGrid);
        const isSolved = solveSudoku(board);
        
        if (!isSolved) {
            console.log("❌ Impossible de résoudre cette grille");
            return false;
        }
        
        const solvedValues = convertTo1D(board);
        console.log(`✅ Solution obtenue: ${solvedValues.filter(v => v !== 0).length}/81 cases`);
        
        console.log("\nÉtape 4: Remplissage de la moitié inférieure (lignes 5-8)");
        await currentPage.bringToFront();
        
        const stillThere = await getSudokuGrid();
        if (!stillThere) {
            console.log("Rechargement de la page...");
            await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
            await sleep(3000);
            if (!await getSudokuGrid()) return false;
        }
        
        const success = await fillLowerHalf(solvedValues);
        if (!success) return false;
        
        console.log("✅ Moitié inférieure terminée!");
        hasCompletedHalf = true;
        
        console.log("📡 Notification au partenaire...");
        await communicateWithPartner("/notify-completion", { completed: true });
        
        console.log("⏳ Attente que le partenaire termine...");
        isWaitingForPartner = true;
        
        // Attendre que les deux moitiés soient terminées
        let waitTimeCompletion = 0;
        const maxWaitCompletion = 60000; // 60 secondes max
        while (isWaitingForPartner && waitTimeCompletion < maxWaitCompletion) {
            await sleep(1000);
            waitTimeCompletion += 1000;
        }
        
        if (isWaitingForPartner) {
            console.log("⏰ Timeout atteint, rechargement forcé");
            await reloadGamePage();
            hasCompletedHalf = false;
            isWaitingForPartner = false;
        }
        
        return true;
        
    } catch (error) {
        console.error(`Erreur dans la résolution: ${error.message}`);
        return false;
    }
}

async function resetBrowser() {
    try {
        if (currentBrowser) {
            if (currentPage) {
                console.log("💾 Sauvegarde des cookies avant réinitialisation...");
                await saveCookies(currentPage);
            }
            await currentBrowser.close();
        }
        
        currentBrowser = await initBrowser();
        currentPage = await initPage(currentBrowser);
        await loadCookies(currentPage);
    } catch (error) {
        console.error("Erreur lors de la réinitialisation:", error);
    }
}

async function solveSudokuProcess() {
    try {
        console.log(`=== Démarrage du solveur Sudoku ${BOT_ID} ===`);
        
        currentBrowser = await initBrowser();
        currentPage = await initPage(currentBrowser);

        const cookiesLoaded = await loadCookies(currentPage);
        
        let loginSuccess = false;
        while (!loginSuccess) {
            loginSuccess = await handleLogin(cookiesLoaded);
            if (!loginSuccess) {
                console.log("Nouvelle tentative de connexion dans 10 secondes...");
                await sleep(10000);
                await currentPage.reload();
            }
        }

        await saveCookies(currentPage);

        let roundNumber = 1;
        const maxRetries = 3;

        while (true) {
            if (solvedCount >= MAX_SOLVED_PER_SESSION) {
                await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
                await sleep(3000);
                
                solvedCount = 0;
                roundNumber = 1;
                continue;
            }

            let retries = 0;
            let success = false;

            while (!success && retries < maxRetries) {
                success = await solveOneSudoku(roundNumber);
                if (!success) {
                    retries++;
                    console.log(`🔄 Tentative ${retries}/${maxRetries}`);
                    
                    await resetBrowser();
                    await handleLogin(false);
                    await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
                    await sleep(3000);
                }
            }

            if (success) {
                roundNumber++;
                solvedCount++;
                console.log(`✅ ${BOT_ID} - Sudoku résolus ce cycle: ${solvedCount}/${MAX_SOLVED_PER_SESSION}`);
            } else {
                console.log("🔁 Réinitialisation complète");
                await resetBrowser();
                solvedCount = 0;
                
                let reconnectSuccess = false;
                while (!reconnectSuccess) {
                    reconnectSuccess = await handleLogin(false);
                    if (!reconnectSuccess) {
                        console.log("Nouvelle tentative de connexion dans 10 secondes...");
                        await sleep(10000);
                        await currentPage.reload();
                    }
                }

                await saveCookies(currentPage);
                await sleep(2000);
            }
        }
    } catch (error) {
        console.error('❌ Erreur:', error);
    } finally {
        if (currentBrowser) {
            await currentBrowser.close();
        }
        isProcessing = false;
        console.log(`👋 ${BOT_ID} - Processus terminé`);
    }
}

// Gestion de l'arrêt propre
process.on('SIGINT', async () => {
    console.log(`\n🛑 ${BOT_ID} - Arrêt par utilisateur`);
    if (currentBrowser) {
        await currentBrowser.close();
    }
    process.exit(0);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Sudoku Solver ${BOT_ID} API running on port ${PORT}`);
    console.log(`📱 Endpoints disponibles:`);
    console.log(`   POST /start-sudoku - Démarre le processus`);
    console.log(`   POST /submit-phone - Soumet le numéro (body: {phone: "123456789"})`);
    console.log(`   POST /submit-otp - Soumet l'OTP (body: {otp: "123456"})`);
    console.log(`   GET /status - Vérifie le statut`);
    console.log(`   POST /partner-status - Communication entre bots`);
    console.log(`   POST /share-grid - Partage de grille`);
    console.log(`   POST /notify-completion - Notification de completion`);
});
