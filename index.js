import express from "express";
import puppeteer from "puppeteer";
import * as dotenv from "dotenv";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

dotenv.config();

const app = express();
app.use(express.json());

// Configuration
const COOKIE_FILE = 'cookies.json';
const MAX_SOLVED_PER_SESSION = 1000;
const GAME_URL = "https://sudoku.lumitelburundi.com/game";
const BASE_URL = "https://sudoku.lumitelburundi.com";
const PARTNER_URL = "https://num66-kudosu.onrender.com"; // URL du bot haut

// Variables d'état
let currentBrowser = null;
let currentPage = null;
let waitingForPhone = false;
let waitingForOTP = false;
let phoneNumber = '';
let otpCode = '';
let isProcessing = false;
let solvedCount = 0;
let myPartDone = false;
let partnerPartDone = false;

// Chemins
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Routes
app.get("/", (req, res) => {
    res.json({
        message: "Sudoku Solver Bot Bas API is running",
        endpoints: {
            start: "/start-sudoku - POST - Démarre le processus",
            phone: "/submit-phone - POST - Soumet le numéro",
            otp: "/submit-otp - POST - Soumet le code OTP",
            status: "/status - GET - Vérifie le statut",
            notify: "/notify-done - POST - Notification partenaire"
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
        myPartDone,
        partnerPartDone
    });
});

app.post("/notify-done", (req, res) => {
    partnerPartDone = true;
    res.json({ success: true, message: "Notification reçue" });
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
        console.log("🚀 Démarrage du solveur Sudoku (Bot Bas)...");
        
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

async function handleLogin(cookiesLoaded = false, maxAttempts = 3) {
    let attempt = 0;
    
    while (attempt < maxAttempts) {
        try {
            await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
            await sleep(2000);
            
            const currentUrl = currentPage.url();
            if (!currentUrl.includes(GAME_URL)) {
                if (cookiesLoaded) cookiesLoaded = false;
                
                await currentPage.waitForSelector("button.w-53.py-3.px-6.bg-gradient-to-r.from-amber-400.to-amber-500.text-white.text-lg.font-bold.rounded-full.shadow-lg.mt-36", { timeout: 30000 });
                await currentPage.click("button.w-53.py-3.px-6.bg-gradient-to-r.from-amber-400.to-amber-500.text-white.text-lg.font-bold.rounded-full.shadow-lg.mt-36");
                await sleep(2000);
                
                await currentPage.waitForFunction(() => window.location.href.includes("/login"));
                
                await currentPage.waitForSelector("input[placeholder='Nimushiremwo inomero ya terefone']", { timeout: 30000 });
                
                waitingForPhone = true;
                phoneNumber = '';
                console.log("📱 En attente du numéro de téléphone...");
                
                while (waitingForPhone || !phoneNumber) await sleep(1000);
                
                await currentPage.type("input[placeholder='Nimushiremwo inomero ya terefone']", phoneNumber);
                await sleep(1000);
                
                await currentPage.click("button.w-full.py-2.bg-red-700.text-white.rounded-md.font-semibold.hover\\:bg-red-600.transition.duration-200");
                await sleep(2000);
                
                await currentPage.waitForSelector("input[placeholder='OTP']", { timeout: 30000 });
                
                waitingForOTP = true;
                otpCode = '';
                console.log("🔐 En attente du code OTP...");
                
                while (waitingForOTP || !otpCode) await sleep(1000);
                
                await currentPage.type("input[placeholder='OTP']", otpCode);
                await sleep(1000);
                
                await currentPage.click("button.w-full.py-2.bg-red-700.text-white.rounded-md.font-semibold.hover\\:bg-red-800.transition.duration-200");
                await sleep(10000);
                
                await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
                await sleep(3000);
                
                if (!currentPage.url().includes(GAME_URL)) {
                    attempt++;
                    continue;
                }
                
                return true;
            }
            
            return true;
            
        } catch (error) {
            attempt++;
            await sleep(5000);
        }
    }
    
    return false;
}

async function getSudokuGrid() {
    try {
        await currentPage.waitForFunction(() => document.readyState === 'complete', { timeout: 5000 });
        await currentPage.waitForSelector("div.grid.grid-cols-9.gap-0.border-4.border-black", { 
            timeout: 20000,
            visible: true
        });
        
        const gridValues = await currentPage.evaluate(() => {
            const cells = document.querySelectorAll("div.grid.grid-cols-9.gap-0.border-4.border-black div.w-10.h-10");
            return Array.from(cells).map(cell => cell.textContent.trim());
        });
        
        if (gridValues.length === 81) return gridValues;
        return null;
    } catch (error) {
        return null;
    }
}

async function fillMyPart(solvedValues) {
    try {
        const cells = await currentPage.$$("div.grid.grid-cols-9.gap-0.border-4.border-black div.w-10.h-10");
        const numberButtons = await currentPage.$$("div.flex.gap-2.mt-4 button");
        
        // Remplir seulement les lignes 5 à 9 (indices 36-80)
        for (let i = 36; i < 81; i++) {
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
                                await sleep(1000);
                            }
                        }
                    } catch (error) {
                        await sleep(1000);
                    }
                }
            }
        }
        return true;
    } catch (error) {
        return false;
    }
}

async function notifyPartnerDone() {
    try {
        await axios.post(`${PARTNER_URL}/notify-done`, {});
        console.log("✅ Partenaire notifié de la complétion");
    } catch (error) {
        console.log("❌ Échec de la notification du partenaire");
    }
}

async function waitForPartner() {
    console.log("⏳ En attente du partenaire...");
    while (!partnerPartDone) {
        await sleep(3000);
        try {
            const response = await axios.get(`${PARTNER_URL}/status`);
            if (response.data.myPartDone) {
                partnerPartDone = true;
                break;
            }
        } catch (error) {
            console.log("Erreur de vérification du partenaire, réessai...");
        }
    }
    console.log("✅ Partenaire a terminé sa partie");
}

async function solveOneSudoku(roundNumber) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🎯 ROUND ${roundNumber} (BOT HAUT)`);
    console.log(`${'='.repeat(50)}`);
    
    try {
        myPartDone = false;
        partnerPartDone = false;
        
        let gridValues = await getSudokuGrid();
        if (!gridValues) {
            await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
            await sleep(3000);
            gridValues = await getSudokuGrid();
            if (!gridValues) return false;
        }
        
        const numericGrid = gridValues.map(val => val === '' ? 0 : parseInt(val));
        const board = convertTo2D(numericGrid);
        const isSolved = solveSudoku(board);
        
        if (!isSolved) return false;
        
        const solvedValues = convertTo1D(board);
        
        const stillThere = await getSudokuGrid();
        if (!stillThere) {
            await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
            await sleep(3000);
            if (!await getSudokuGrid()) return false;
        }
        
        await fillMyPart(solvedValues);
        myPartDone = true;
        await notifyPartnerDone();
        
        await waitForPartner();
        
        console.log("🔄 Rechargement de la page pour un nouveau sudoku...");
        await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
        await sleep(3000);
        
        return true;
    } catch (error) {
        return false;
    }
}

async function solveSudokuProcess() {
    try {
        currentBrowser = await initBrowser();
        currentPage = await initPage(currentBrowser);

        const cookiesLoaded = await loadCookies(currentPage);
        
        let loginSuccess = false;
        while (!loginSuccess) {
            loginSuccess = await handleLogin(cookiesLoaded);
            if (!loginSuccess) await sleep(10000);
        }

        let roundNumber = 1;
        const maxRetries = 3;

        while (true) {
            if (solvedCount >= MAX_SOLVED_PER_SESSION) {
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
                    await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
                    await sleep(3000);
                }
            }

            if (success) {
                roundNumber++;
                solvedCount++;
            } else {
                await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
                await sleep(3000);
            }
        }
    } catch (error) {
        console.error('❌ Erreur:', error);
    } finally {
        if (currentBrowser) await currentBrowser.close();
        isProcessing = false;
    }
}

process.on('SIGINT', async () => {
    if (currentBrowser) await currentBrowser.close();
    process.exit(0);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Sudoku Solver Bot Bas running on port ${PORT}`);
});
