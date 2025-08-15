import express from "express";
import puppeteer from "puppeteer";
import * as dotenv from "dotenv";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();

// Configuration CORS complète
app.use((req, res, next) => {
    // Permettre toutes les origines (vous pouvez restreindre à des domaines spécifiques)
    res.header('Access-Control-Allow-Origin', '*');
    
    // Permettre les méthodes HTTP
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    
    // Permettre les en-têtes spécifiques
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control, Pragma');
    
    // Gérer les requêtes preflight OPTIONS
    if (req.method === 'OPTIONS') {
        res.status(200).send();
        return;
    }
    
    next();
});

app.use(express.json());

// Configuration par défaut
const COOKIE_FILE = 'cookies.json';
let LOGIN_URL = "https://sweety.lumitel.bi/Home/Login";
let GAME_URL = "https://sweety.lumitel.bi/Game/StartHtmlGameNoView";

// Variables d'état
let currentBrowser = null;
let currentPage = null;
let waitingForCredentials = false;
let isProcessing = false;
let gameStats = {
    totalRounds: 0,
    totalPoints: 0,
    errors: 0,
    startTime: null,
    currentRound: 0
};

// Chemins
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Routes API
app.get("/", (req, res) => {
    res.json({
        message: "🎮 Sweety Game Bot API",
        version: "1.0.0",
        status: isProcessing ? "RUNNING" : waitingForCredentials ? "WAITING_FOR_CREDENTIALS" : "READY",
        endpoints: {
            status: "GET /status - Statut détaillé du bot",
            stats: "GET /stats - Statistiques de jeu",
            start: "POST /start-game - Démarre le bot",
            stop: "POST /stop-game - Arrête le bot",
            config: "POST /config - Configure les URLs"
        }
    });
});

app.get("/status", (req, res) => {
    res.json({
        isProcessing,
        waitingForCredentials,
        hasBrowser: !!currentBrowser,
        hasPage: !!currentPage,
        currentRound: gameStats.currentRound,
        totalRounds: gameStats.totalRounds,
        loginUrl: LOGIN_URL,
        gameUrl: GAME_URL
    });
});

app.get("/stats", (req, res) => {
    const uptime = gameStats.startTime ? Date.now() - gameStats.startTime : 0;
    const avgPointsPerRound = gameStats.totalRounds > 0 ? gameStats.totalPoints / gameStats.totalRounds : 0;
    
    res.json({
        totalRounds: gameStats.totalRounds,
        totalPoints: gameStats.totalPoints,
        errors: gameStats.errors,
        currentRound: gameStats.currentRound,
        uptime: Math.floor(uptime / 1000), // en secondes
        averagePointsPerRound: Math.floor(avgPointsPerRound),
        successRate: gameStats.totalRounds + gameStats.errors > 0 ? 
            ((gameStats.totalRounds / (gameStats.totalRounds + gameStats.errors)) * 100).toFixed(2) + '%' : '0%'
    });
});

app.post("/start-game", async (req, res) => {
    const { phone, password, rounds = 10 } = req.body;
    
    if (isProcessing) {
        return res.status(400).json({
            success: false,
            error: "Le bot est déjà en cours d'exécution"
        });
    }

    if (!phone || !password) {
        return res.status(400).json({
            success: false,
            error: "Numéro de téléphone et mot de passe requis"
        });
    }

    try {
        isProcessing = true;
        gameStats.startTime = Date.now();
        gameStats.currentRound = 0;
        
        console.log("🚀 Démarrage du bot Sweety Game...");
        
        // Lancer le processus de jeu
        startGameBot(phone, password, rounds).catch(error => {
            console.error("❌ Erreur dans le processus:", error);
            isProcessing = false;
            gameStats.errors++;
        });

        res.json({
            success: true,
            message: "Bot démarré avec succès!",
            config: {
                phone: phone.substring(0, 3) + "****",
                rounds,
                loginUrl: LOGIN_URL,
                gameUrl: GAME_URL
            }
        });
    } catch (error) {
        isProcessing = false;
        gameStats.errors++;
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post("/stop-game", (req, res) => {
    if (!isProcessing) {
        return res.status(400).json({
            success: false,
            error: "Aucun processus en cours"
        });
    }

    isProcessing = false;
    console.log("🛑 Arrêt du bot demandé par l'utilisateur");
    
    res.json({
        success: true,
        message: "Bot arrêté",
        finalStats: {
            totalRounds: gameStats.totalRounds,
            totalPoints: gameStats.totalPoints,
            errors: gameStats.errors,
            uptime: Math.floor((Date.now() - gameStats.startTime) / 1000)
        }
    });
});

app.post("/config", (req, res) => {
    const { loginUrl, gameUrl } = req.body;
    
    if (isProcessing) {
        return res.status(400).json({
            success: false,
            error: "Impossible de modifier la configuration pendant l'exécution"
        });
    }

    if (loginUrl) LOGIN_URL = loginUrl;
    if (gameUrl) GAME_URL = gameUrl;
    
    gameStats.totalRounds = 0;
    gameStats.totalPoints = 0;
    gameStats.errors = 0;
    gameStats.startTime = null;
    gameStats.currentRound = 0;
    
    res.json({
        success: true,
        message: "Configuration mise à jour",
        config: {
            loginUrl: LOGIN_URL,
            gameUrl: GAME_URL
        }
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

// Fonction de connexion
async function handleLogin(phone, password, maxAttempts = 3) {
    let attempt = 0;
    
    while (attempt < maxAttempts) {
        try {
            console.log(`\n🔐 Tentative de connexion ${attempt + 1}/${maxAttempts}`);
            
            // Aller à la page de connexion
            await currentPage.goto(LOGIN_URL, { waitUntil: "networkidle2" });
            await sleep(3000);
            
            // Remplir le formulaire de connexion
            console.log("📱 Saisie du numéro de téléphone...");
            await currentPage.waitForSelector('#msisdn', { timeout: 30000 });
            await currentPage.type('#msisdn', phone);
            await sleep(1000);
            
            console.log("🔒 Saisie du mot de passe...");
            await currentPage.waitForSelector('#password', { timeout: 30000 });
            await currentPage.type('#password', password);
            await sleep(1000);
            
            // Cliquer sur le bouton de connexion
            console.log("🚀 Clic sur le bouton LOGIN...");
            await currentPage.click('#login');
            
            // Attendre 10 secondes comme spécifié
            console.log("⏳ Attente de 10 secondes...");
            await sleep(10000);
            
            // Vérifier si la connexion a réussi
            const currentUrl = currentPage.url();
            if (!currentUrl.includes('/Login')) {
                console.log("✅ Connexion réussie!");
                await saveCookies(currentPage);
                return true;
            }
            
            console.log("❌ Connexion échouée, nouvelle tentative...");
            attempt++;
            await sleep(5000);
            
        } catch (error) {
            console.log(`❌ Erreur lors de la tentative de connexion: ${error.message}`);
            attempt++;
            await sleep(5000);
        }
    }
    
    console.log(`❌ Échec après ${maxAttempts} tentatives de connexion`);
    return false;
}

// Fonction pour récupérer et envoyer le score
async function playGameRound() {
    try {
        console.log("🎮 Navigation vers la page de jeu...");
        await currentPage.goto(GAME_URL, { waitUntil: "networkidle2" });
        await sleep(1000);
        
        // Récupérer le score maximum
        console.log("🔍 Recherche du score maximum...");
        const maxScore = await currentPage.evaluate(() => {
            const maxScoreElement = document.querySelector('#maxS');
            return maxScoreElement ? parseInt(maxScoreElement.value) : null;
        });
        
        if (!maxScore) {
            throw new Error("Impossible de récupérer le score maximum");
        }
        
        console.log(`🎯 Score maximum trouvé: ${maxScore}`);

        // attente de 40 seconde obligatoire
        await sleep(1000 * 40);
        
        // Exécuter le script de soumission de score
        console.log("📤 Envoi du score...");
        const result = await currentPage.evaluate(async (score) => {
            try {
                // Récupérer l'ID du joueur
                const _player = document.getElementById("player").value;
                console.log(`👤 Player ID: ${_player}`);
                
                // Créer la clé HMAC avec l'ID du joueur
                const encoder = new TextEncoder();
                const keyData = encoder.encode(_player);
                
                const cryptoKey = await crypto.subtle.importKey(
                    "raw",
                    keyData,
                    { name: "HMAC", hash: "SHA-256" },
                    false,
                    ["sign"]
                );
                
                // Créer le message à signer (score entouré d'espaces)
                const data = encoder.encode(" " + score + " ");
                
                // Générer la signature HMAC
                const signature = await crypto.subtle.sign("HMAC", cryptoKey, data);
                
                // Convertir en hexadécimal
                const hex = [...new Uint8Array(signature)]
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join('');
                
                console.log(`🔐 Code HMAC: ${hex}`);
                
                // Récupérer le token CSRF
                const csrfToken = document.querySelector("input[name=__RequestVerificationToken]").value;
                console.log(`🔑 Token CSRF: ${csrfToken}`);
                
                // Envoyer la requête POST
                return new Promise((resolve, reject) => {
                    if (typeof jQuery !== 'undefined') {
                        jQuery.ajax({
                            type: "POST",
                            url: "/Game/AddCoins",
                            headers: {
                                RequestVerificationToken: csrfToken,
                                Accept: "application/json",
                            },
                            data: {
                                playGameCoins: score,
                                code: hex
                            },
                            success: function (data) {
                                console.log(`✅ Score ${score} envoyé avec succès!`);
                                resolve({ success: true, score, data });
                            },
                            error: function (xhr, status, error) {
                                console.error(`❌ Erreur envoi score ${score}:`, error);
                                reject(new Error(`Erreur AJAX: ${error}`));
                            }
                        });
                    } else {
                        // Fallback avec fetch si jQuery n'est pas disponible
                        fetch("/Game/AddCoins", {
                            method: "POST",
                            headers: {
                                "RequestVerificationToken": csrfToken,
                                "Accept": "application/json",
                                "Content-Type": "application/x-www-form-urlencoded"
                            },
                            body: `playGameCoins=${score}&code=${hex}`
                        })
                        .then(response => response.json())
                        .then(data => {
                            console.log(`✅ Score ${score} envoyé avec succès!`);
                            resolve({ success: true, score, data });
                        })
                        .catch(error => {
                            console.error(`❌ Erreur envoi score ${score}:`, error);
                            reject(error);
                        });
                    }
                });
                
            } catch (error) {
                console.error(`❌ Erreur lors de l'envoi du score ${score}:`, error);
                throw error;
            }
        }, maxScore);
        
        if (result.success) {
            gameStats.totalPoints += maxScore;
            console.log(`✅ Round réussi! Score ajouté: ${maxScore}`);
            return true;
        }
        
        return false;
        
    } catch (error) {
        console.error(`❌ Erreur dans le round de jeu: ${error.message}`);
        return false;
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

// Processus principal du bot
async function startGameBot(phone, password, maxRounds) {
    try {
        console.log("🤖 === DÉMARRAGE DU BOT SWEETY GAME ===");
        console.log(`📞 Téléphone: ${phone.substring(0, 3)}****`);
        console.log(`🎯 Nombre de rounds: ${maxRounds}`);
        
        // Initialiser le navigateur
        currentBrowser = await initBrowser();
        currentPage = await initPage(currentBrowser);
        
        // Charger les cookies existants
        await loadCookies(currentPage);
        
        // Se connecter
        const loginSuccess = await handleLogin(phone, password);
        if (!loginSuccess) {
            throw new Error("Impossible de se connecter");
        }
        
        // Boucle de jeu
        while (isProcessing && gameStats.currentRound < maxRounds) {
            gameStats.currentRound++;
            
            console.log(`\n🎮 === ROUND ${gameStats.currentRound}/${maxRounds} ===`);
            
            const roundSuccess = await playGameRound();
            
            if (roundSuccess) {
                gameStats.totalRounds++;
                console.log(`✅ Round ${gameStats.currentRound} terminé avec succès!`);
                console.log(`📊 Points total: ${gameStats.totalPoints}`);
            } else {
                console.log(`❌ Échec du round ${gameStats.currentRound} Reconnexion...`);
                await resetBrowser();
                let loginSuccess = await handleLogin(phone, password);
                if (!loginSuccess) {
                    gameStats.errors++;
                    throw new Error("Impossible de se connecter");
                }
                gameStats.currentRound--;
                continue;
            }
            
            // Pause entre les rounds (sauf pour le dernier)
            if (gameStats.currentRound < maxRounds && isProcessing) {
                console.log("⏳ Pause de 7 secondes avant le prochain round...");
                await sleep(7000);
            }
        }
        
        console.log("\n🏁 === JEU TERMINÉ ===");
        console.log(`📊 Statistiques finales:`);
        console.log(`   - Rounds réussis: ${gameStats.totalRounds}/${maxRounds}`);
        console.log(`   - Points total: ${gameStats.totalPoints}`);
        console.log(`   - Erreurs: ${gameStats.errors}`);
        
    } catch (error) {
        console.error('❌ Erreur dans le processus principal:', error);
        gameStats.errors++;
    } finally {
        if (currentBrowser) {
            await currentBrowser.close();
            currentBrowser = null;
            currentPage = null;
        }
        isProcessing = false;
        console.log('👋 Processus terminé');
    }
}

// Gestion de l'arrêt propre
process.on('SIGINT', async () => {
    console.log('\n🛑 Arrêt par utilisateur');
    isProcessing = false;
    if (currentBrowser) {
        await currentBrowser.close();
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Arrêt par SIGTERM');
    isProcessing = false;
    if (currentBrowser) {
        await currentBrowser.close();
    }
    process.exit(0);
});

// Démarrage du serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Sweety Game Bot API running on port ${PORT}`);
    console.log(`📱 Endpoints disponibles:`);
    console.log(`   POST /start-game - Démarre le bot (body: {phone, password, rounds})`);
    console.log(`   POST /stop-game - Arrête le bot`);
    console.log(`   POST /config - Configure les URLs (body: {loginUrl, gameUrl})`);
    console.log(`   GET /status - Statut du bot`);
    console.log(`   GET /stats - Statistiques détaillées`);
    console.log(`\n💡 Usage:`);
    console.log(`   1. POST /start-game avec phone, password et rounds`);
    console.log(`   2. Le bot se connectera et jouera automatiquement`);
    console.log(`   3. Utilisez /stats pour suivre les progrès`);
});
