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
const COOKIE_FILE = 'cookies_bot2.json';
const MAX_SOLVED_PER_SESSION = 1000;
const GAME_URL = "https://sudoku.lumitelburundi.com/game";
const BASE_URL = "https://sudoku.lumitelburundi.com";
const BOT_ID = 2;
const PARTNER_BOT_URL = "https://num66-kudosu.onrender.com"; // URL du bot 1

// Variables d'état
let currentBrowser = null;
let currentPage = null;
let waitingForPhone = false;
let waitingForOTP = false;
let phoneNumber = '';
let otpCode = '';
let isProcessing = false;
let solvedCount = 0;

// Variables de coopération
let isMyHalfCompleted = false;
let isPartnerHalfCompleted = false;
let currentRound = 0;

// Chemins
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Routes
app.get("/", (req, res) => {
    res.json({
        message: "Sudoku Solver Bot 2 (Partie basse) API is running",
        bot_id: BOT_ID,
        responsible_for: "Lignes 5-9 (45 dernières cases)",
        endpoints: {
            start: "/start-sudoku - POST - Démarre le processus de résolution",
            phone: "/submit-phone - POST - Soumet le numéro de téléphone",
            otp: "/submit-otp - POST - Soumet le code OTP",
            status: "/status - GET - Vérifie le statut du processus",
            cooperation: "/cooperation-status - GET - Statut de coopération",
            notify: "/notify-completion - POST - Notification de completion"
        }
    });
});

app.get("/status", (req, res) => {
    res.json({
        bot_id: BOT_ID,
        isProcessing,
        waitingForPhone,
        waitingForOTP,
        hasBrowser: !!currentBrowser,
        hasPage: !!currentPage,
        solvedCount,
        maxPerSession: MAX_SOLVED_PER_SESSION,
        currentRound,
        myHalfCompleted: isMyHalfCompleted,
        partnerHalfCompleted: isPartnerHalfCompleted
    });
});

app.get("/cooperation-status", (req, res) => {
    res.json({
        bot_id: BOT_ID,
        isProcessing,
        myHalfCompleted: isMyHalfCompleted,
        currentRound
    });
});

app.post("/notify-completion", (req, res) => {
    const { bot_id, round, completed } = req.body;
    
    if (bot_id === 1 && round === currentRound) {
        isPartnerHalfCompleted = completed;
        console.log(`🤝 Bot 1 a notifié: ${completed ? 'terminé' : 'pas terminé'} pour le round ${round}`);
    }
    
    res.json({
        success: true,
        message: "Notification reçue",
        current_status: {
            myHalf: isMyHalfCompleted,
            partnerHalf: isPartnerHalfCompleted
        }
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
        solvedCount = 0;
        console.log("🚀 Démarrage du solveur Sudoku Bot 2 (Partie basse)...");
        
        solveSudokuProcess().catch(error => {
            console.error("Erreur dans le processus:", error);
            isProcessing = false;
        });

        res.json({
            success: true,
            message: "Processus de résolution démarré - Bot 2"
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
        message: "Numéro de téléphone reçu - Bot 2"
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
        message: "Code OTP reçu - Bot 2"
    });
});

// Fonctions de coopération
async function checkPartnerStatus() {
    try {
        const response = await fetch(`${PARTNER_BOT_URL}/cooperation-status`);
        if (response.ok) {
            const data = await response.json();
            return data.isProcessing;
        }
        return false;
    } catch (error) {
        console.error("Erreur lors de la vérification du statut du partenaire:", error.message);
        return false;
    }
}

async function notifyPartner(completed) {
    try {
        const response = await fetch(`${PARTNER_BOT_URL}/notify-completion`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                bot_id: BOT_ID,
                round: currentRound,
                completed: completed
            })
        });

        if (response.ok) {
            console.log(`🤝 Partenaire notifié: ${completed ? 'terminé' : 'pas terminé'}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error("Erreur lors de la notification du partenaire:", error.message);
        return false;
    }
}

async function waitForPartnerCompletion() {
    console.log("⏳ Attente de la completion du partenaire...");
    while (!isPartnerHalfCompleted) {
        await sleep(3000);
        console.log("⏳ Toujours en attente du partenaire...");
    }
    console.log("✅ Partenaire a terminé sa partie!");
}

// Gestion des cookies
async function saveCookies(page) {
    try {
        const cookies = await page.cookies();
        fs.writeFileSync(path.join(__dirname, COOKIE_FILE), JSON.stringify(cookies, null, 2));
        console.log('🍪 Cookies sauvegardés - Bot 2');
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
            console.log('🍪 Cookies chargés - Bot 2');
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
    // Vérifie la ligne
    for (let d = 0; d < board.length; d++) {
        if (board[row][d] === num) {
            return false;
        }
    }

    // Vérifie la colonne
    for (let r = 0; r < board.length; r++) {
        if (board[r][col] === num) {
            return false;
        }
    }

    // Vérifie la sous-grille 3x3
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

async function handleLogin(cookiesLoaded = false, maxAttempts = 3) {
    let attempt = 0;
    
    while (attempt < maxAttempts) {
        try {
            console.log(`\n[Bot 2] Tentative de connexion ${attempt + 1}/${maxAttempts}`);
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
                console.log("📱 [Bot 2] En attente du numéro de téléphone via l'API...");
                
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
                console.log("🔐 [Bot 2] En attente du code OTP via l'API...");
                
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
                
                console.log("[Bot 2] Connexion réussie!");
                return true;
            }
            
            console.log("[Bot 2] Déjà connecté, poursuite du script...");
            return true;
            
        } catch (error) {
            console.log(`[Bot 2] Erreur lors de la tentative de connexion: ${error.message}`);
            attempt++;
            await sleep(5000);
        }
    }
    
    console.log(`[Bot 2] Échec après ${maxAttempts} tentatives de connexion`);
    return false;
}

async function getSudokuGrid() {
    try {
        // Vérifier d'abord si la page est toujours responsive
        try {
            await currentPage.waitForFunction(() => document.readyState === 'complete', { timeout: 5000 });
        } catch (e) {
            console.log("⚠ La page ne répond pas, tentative de rafraîchissement...");
            await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
            await sleep(3000);
        }

        // Attendre le sélecteur avec un timeout raisonnable
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

// Fonction spécialisée pour remplir seulement la partie basse (lignes 4-8, cases 36-80)
async function fillMyHalf(solvedValues) {
    try {
        const cells = await currentPage.$("div.grid.grid-cols-9.gap-0.border-4.border-black div.w-10.h-10");
        const numberButtons = await currentPage.$("div.flex.gap-2.mt-4 button");
        
        // Bot 2 s'occupe des 5 dernières lignes (cases 36 à 80)
        const startIndex = 36; // À partir de la 5ème ligne
        
        for (let i = startIndex; i < Math.min(cells.length, 81); i++) {
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
                                
                                console.log(`⚠ [Bot 2] Réessai case ${i} (valeur non prise)`);
                                await sleep(1000);
                            }
                        }
                    } catch (error) {
                        console.log(`[Bot 2] Erreur case ${i}: ${error.message.substring(0, 50)}`);
                        await sleep(1000);
                    }
                }
            }
        }
        return true;
    } catch (error) {
        console.error(`[Bot 2] Erreur remplissage: ${error.message}`);
        return false;
    }
}

async function solveOneSudoku(roundNumber) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🎯 [Bot 2] ROUND ${roundNumber}`);
    console.log(`${'='.repeat(50)}`);
    
    try {
        // Vérifier que le partenaire est aussi en cours de traitement
        console.log("🤝 Vérification du statut du partenaire...");
        const partnerActive = await checkPartnerStatus();
        if (!partnerActive) {
            console.log("⚠ Partenaire pas actif, attente...");
            await sleep(5000);
            return false;
        }
        
        // Réinitialiser les états de coopération
        isMyHalfCompleted = false;
        isPartnerHalfCompleted = false;
        currentRound = roundNumber;
        
        console.log("Étape 1: Chargement de la grille");
        await currentPage.bringToFront();
        
        // Tentative de récupération de la grille avec rafraîchissement si échec
        let gridValues = await getSudokuGrid();
        if (!gridValues) {
            console.log("🔄 Rafraîchissement de la page...");
            await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
            await sleep(3000);
            gridValues = await getSudokuGrid();
            if (!gridValues) return false;
        }
        
        // Convertir les valeurs de la grille en nombres (0 pour les cases vides)
        const numericGrid = gridValues.map(val => val === '' ? 0 : parseInt(val));
        
        console.log("\n[Bot 2] Étape 2: Résolution du Sudoku");
        const board = convertTo2D(numericGrid);
        const isSolved = solveSudoku(board);
        
        if (!isSolved) {
            console.log("❌ [Bot 2] Impossible de résoudre cette grille");
            return false;
        }
        
        const solvedValues = convertTo1D(board);
        console.log(`✅ [Bot 2] Solution obtenue: ${solvedValues.filter(v => v !== 0).length}/81 cases`);
        
        console.log("\n[Bot 2] Étape 3: Remplissage de ma moitié (5 dernières lignes)");
        const stillThere = await getSudokuGrid();
        if (!stillThere) {
            console.log("Rechargement de la page...");
            await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
            await sleep(3000);
            if (!await getSudokuGrid()) return false;
        }
        
        const success = await fillMyHalf(solvedValues);
        if (!success) return false;
        
        // Marquer ma partie comme terminée
        isMyHalfCompleted = true;
        console.log("✅ [Bot 2] Ma moitié terminée!");
        
        // Notifier le partenaire
        await notifyPartner(true);
        
        // Attendre que le partenaire termine sa partie
        await waitForPartnerCompletion();
        
        console.log("\n[Bot 2] Étape 4: Rechargement de la page pour un nouveau Sudoku");
        try {
            await currentPage.reload({ waitUntil: "networkidle2" });
            await sleep(4000);
            console.log("✅ [Bot 2] Nouvelle grille chargée avec succès!");
            return true;
        } catch (error) {
            console.log("[Bot 2] Échec du rechargement - nouvelle tentative...");
            await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
            await sleep(3000);
            return false;
        }
        
    } catch (error) {
        console.error(`[Bot 2] Erreur dans la résolution: ${error.message}`);
        return false;
    }
}

async function resetBrowser() {
    try {
        if (currentBrowser) {
            // Sauvegarder les cookies avant de fermer le navigateur
            if (currentPage) {
                console.log("💾 [Bot 2] Sauvegarde des cookies avant réinitialisation...");
                await saveCookies(currentPage);
            }
            await currentBrowser.close();
        }
        
        currentBrowser = await initBrowser();
        currentPage = await initPage(currentBrowser);
        await loadCookies(currentPage);
    } catch (error) {
        console.error("[Bot 2] Erreur lors de la réinitialisation:", error);
    }
}

async function solveSudokuProcess() {
    try {
        console.log("=== [Bot 2] Démarrage du solveur Sudoku ===");
        
        currentBrowser = await initBrowser();
        currentPage = await initPage(currentBrowser);

        const cookiesLoaded = await loadCookies(currentPage);
        
        let loginSuccess = false;
        while (!loginSuccess) {
            loginSuccess = await handleLogin(cookiesLoaded);
            if (!loginSuccess) {
                console.log("[Bot 2] Nouvelle tentative de connexion dans 10 secondes...");
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
                    console.log(`🔄 [Bot 2] Tentative ${retries}/${maxRetries}`);
                    
                    // Rafraîchir la page avant de réessayer
                    console.log("🔄 [Bot 2] Rafraîchissement de la page principale...");
                    await resetBrowser();
                    await handleLogin(false);
                    await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
                    await sleep(3000);
                }
            }

            if (success) {
                roundNumber++;
                solvedCount++;
                console.log(`✅ [Bot 2] Sudoku résolus ce cycle: ${solvedCount}/${MAX_SOLVED_PER_SESSION}`);
            } else {
                console.log("🔁 [Bot 2] Réinitialisation complète");
                await resetBrowser();
                solvedCount = 0;
                
                let reconnectSuccess = false;
                while (!reconnectSuccess) {
                    reconnectSuccess = await handleLogin(false);
                    if (!reconnectSuccess) {
                        console.log("[Bot 2] Nouvelle tentative de connexion dans 10 secondes...");
                        await sleep(10000);
                        await currentPage.reload();
                    }
                }

                await saveCookies(currentPage);
                await sleep(2000);
            }
        }
    } catch (error) {
        console.error('[Bot 2] ❌ Erreur:', error);
    } finally {
        if (currentBrowser) {
            await currentBrowser.close();
        }
        isProcessing = false;
        console.log('[Bot 2] 👋 Processus terminé');
    }
}

// Gestion de l'arrêt propre
process.on('SIGINT', async () => {
    console.log('\n🛑 [Bot 2] Arrêt par utilisateur');
    if (currentBrowser) {
        await currentBrowser.close();
    }
    process.exit(0);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 [Bot 2] Sudoku Solver API running on port ${PORT}`);
    console.log(`📱 [Bot 2] Endpoints disponibles:`);
    console.log(`   POST /start-sudoku - Démarre le processus`);
    console.log(`   POST /submit-phone - Soumet le numéro (body: {phone: "123456789"})`);
    console.log(`   POST /submit-otp - Soumet l'OTP (body: {otp: "123456"})`);
    console.log(`   GET /status - Vérifie le statut`);
    console.log(`   GET /cooperation-status - Statut de coopération`);
    console.log(`   POST /notify-completion - Notification de completion`);
});
