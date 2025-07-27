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
const COOKIE_FILE = 'cookies.json';
const MAX_SOLVED_PER_SESSION = 1000;
const GAME_URL = "https://sudoku.lumitelburundi.com/game";
const BASE_URL = "https://sudoku.lumitelburundi.com";
const PARTNER_URL = "https://inferior3-kudosu.onrender.com";

// Variables d'état
let currentBrowser = null;
let currentPage = null;
let waitingForPhone = false;
let waitingForOTP = false;
let phoneNumber = '';
let otpCode = '';
let isProcessing = false;
let solvedCount = 0;

// Variables d'état - MODIFIÉES
let myStatus = {
    isProcessing: false,    // Si je suis en train de travailler
    hasFinished: false      // Si j'ai fini MA partie du Sudoku
};

let partnerStatus = {
    hasFinished: false      // Si le partenaire a fini SA partie
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Routes
app.get("/", (req, res) => {
    res.json({
        message: "Sudoku Solver Bot 1 (Top Half) is running",
        endpoints: {
            start: "/start-sudoku - POST - Démarre le processus",
            phone: "/submit-phone - POST - Soumet le numéro",
            otp: "/submit-otp - POST - Soumet le code OTP",
            status: "/status - GET - Vérifie le statut",
            partner: "/partner-status - GET - Statut du partenaire"
        }
    });
});

app.get("/status", (req, res) => {
    res.json({
        isProcessing,
        waitingForPhone,
        waitingForOTP,
        hasBrowser: !!currentBrowser,
        hasPage: !!currentPage,
        solvedCount,
        maxPerSession: MAX_SOLVED_PER_SESSION,
        hasFinished: myStatus.hasFinished
    });
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
        myStatus.isProcessing = true;
        myStatus.hasFinished = false;
        solvedCount = 0;
        console.log("🚀 Démarrage du solveur Sudoku (Bot 1 - Top Half)...");
        
        solveSudokuProcess().catch(error => {
            console.error("Erreur dans le processus:", error);
            isProcessing = false;
        });

        res.json({
            success: true,
            message: "Processus de résolution démarré"
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

// Routes MODIFIÉES
app.get("/partner-status", (req, res) => {
    res.json({
        isProcessing: myStatus.isProcessing,
        hasFinished: myStatus.hasFinished
    });
});

app.post("/notify-finished", (req, res) => {
    partnerStatus.hasFinished = req.body.finished; // On met à jour le statut du partenaire
    res.json({ success: true });
});

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

async function checkPartnerStatus() {
    try {
        const response = await fetch(`${PARTNER_URL}/partner-status`);
        return await response.json();
    } catch (error) {
        console.error("Erreur de vérification du partenaire:", error.message);
        throw error;
    }
}

async function notifyPartnerFinished() {
    try {
        const response = await fetch(`${PARTNER_URL}/notify-finished`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ finished: true })
        });
        return await response.json();
    } catch (error) {
        console.error("Erreur de notification du partenaire:", error.message);
        throw error;
    }
}

async function waitForPartner() {
    console.log("⏳ En attente que le partenaire termine sa partie...");
    while (true) {
        try {
            const status = await checkPartnerStatus();
            if (status.hasFinished) {
                console.log("✅ Partenaire a terminé sa partie");
                return true;
            }
            await sleep(1000);
        } catch (error) {
            console.log("Erreur de vérification du partenaire, nouvelle tentative dans 5 secondes...");
            await sleep(5000);
        }
    }
}

function isSafe(board, row, col, num) {
    for (let d = 0; d < board.length; d++) {
        if (board[row][d] === num) {
            return false;
        }
    }

    for (let r = 0; r < board.length; r++) {
        if (board[r][col] === num) {
            return false;
        }
    }

    const sqrt = Math.floor(Math.sqrt(board.length));
    const boxRowStart = row - row % sqrt;
    const boxColStart = col - col % sqrt;

    for (let r = boxRowStart; r < boxRowStart + sqrt; r++) {
        for (let d = boxColStart; d < boxColStart + sqrt; d++) {
            if (board[r][d] === num) {
                return false;
            }
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
        if (!isEmpty) {
            break;
        }
    }

    if (isEmpty) {
        return true;
    }

    for (let num = 1; num <= n; num++) {
        if (isSafe(board, row, col, num)) {
            board[row][col] = num;
            if (solveSudoku(board)) {
                return true;
            } else {
                board[row][col] = 0;
            }
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

async function fillTopHalf(solvedValues) {
    try {
        const cells = await currentPage.$$("div.grid.grid-cols-9.gap-0.border-4.border-black div.w-10.h-10");
        const numberButtons = await currentPage.$$("div.flex.gap-2.mt-4 button");
        
        for (let i = 0; i < 36; i++) {
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
        console.error(`Erreur remplissage: ${error.message}`);
        return false;
    }
}

async function handleLogin(cookiesLoaded = false, maxAttempts = 3) {
    let attempt = 0;
    
    while (attempt < maxAttempts) {
        try {
            console.log(`\nTentative de connexion ${attempt + 1}/${maxAttempts}`);
            await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
            await sleep(2000);

            await currentPage.reload({ waitUntil: "networkidle2" });
            await sleep(3000);
            
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
                console.log("📱 En attente du numéro de téléphone via l'API...");
                
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
                console.log("🔐 En attente du code OTP via l'API...");
                
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
                
                console.log("Connexion réussie!");
                return true;
            }
            
            console.log("Déjà connecté, poursuite du script...");
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

async function solveOneSudoku(roundNumber) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🎯 ROUND ${roundNumber} (BOT 1 - TOP HALF)`);
    console.log(`${'='.repeat(50)}`);
    
    try {
        myStatus.isProcessing = true;
        myStatus.hasFinished = false;

        console.log("Étape 1: Chargement de la grille");
        await currentPage.bringToFront();
        
        let gridValues = await getSudokuGrid();
        if (!gridValues) {
            console.log("🔄 Rafraîchissement de la page...");
            await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
            await sleep(3000);
            gridValues = await getSudokuGrid();
            if (!gridValues) return false;
        }
        
        const numericGrid = gridValues.map(val => val === '' ? 0 : parseInt(val));
        
        console.log("\nÉtape 2: Résolution du Sudoku (partie haute)");
        const board = convertTo2D(numericGrid);
        const isSolved = solveSudoku(board);
        
        if (!isSolved) {
            console.log("❌ Impossible de résoudre cette grille");
            return false;
        }
        
        const solvedValues = convertTo1D(board);
        console.log(`✅ Solution obtenue, remplissage des lignes 0-3 (36 premières cellules)`);

        console.log("\nÉtape 3: Remplissage de la solution (partie haute)");
        const success = await fillTopHalf(solvedValues);
        if (!success) return false;
        
        console.log("📢 Notification du partenaire");
        myStatus.hasFinished = true; // Je signale que J'AI FINI
        await notifyPartnerFinished();

        console.log("Attente du partenaire...");
        await waitForPartner(); // Attend que le partenaire (bot inferieur) termine

        console.log("\nÉtape 4: Rechargement de la page");
        await currentPage.reload({ waitUntil: "networkidle2" });
        await sleep(4000);
        
        myStatus.hasFinished = false; // Réinitialisation pour le prochain Sudoku
        return true;
        
    } catch (error) {
        console.error(`Erreur dans la résolution: ${error.message}`);
        return false;
    } finally {
        myStatus.isProcessing = false;
    }
}

async function resetBrowser() {
    try {
        if (currentBrowser) {
            await currentBrowser.close();
        }
        
        currentBrowser = await initBrowser();
        currentPage = await initPage(currentBrowser);
    } catch (error) {
        console.error("Erreur lors de la réinitialisation:", error);
    }
}

async function solveSudokuProcess() {
    try {
        console.log("=== Démarrage du solveur Sudoku (Bot 2 - TOP Half) ===");
        
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
                    
                    console.log("🔄 Rafraîchissement de la page principale...");
                    await resetBrowser();
                    await handleLogin(false);
                    await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
                    await sleep(3000);
                }
            }

            if (success) {
                roundNumber++;
                solvedCount++;
                console.log(`✅ Sudoku résolus ce cycle: ${solvedCount}/${MAX_SOLVED_PER_SESSION}`);
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
        console.log('👋 Processus terminé');
    }
}

process.on('SIGINT', async () => {
    console.log('\n🛑 Arrêt par utilisateur');
    if (currentBrowser) {
        await currentBrowser.close();
    }
    process.exit(0);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Sudoku Solver Bot 2 (Bottom Half) running on port ${PORT}`);
    console.log(`🤝 Partenaire configuré: ${PARTNER_URL}`);
});
