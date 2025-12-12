import { Application, Container, Graphics, Text, Ticker } from 'pixi.js';
import { CardDef, CardType, ElementType, EnemyDef, GameState, MapType, PlayerStats, Rarity } from './types';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from './constants';

// --- internal types ---
type Entity = Container & {
    vx: number;
    vy: number;
    hp: number;
    maxHp: number;
    isDead: boolean;
    radius: number;
    // Status
    isBurning: boolean;
    burnTimer: number;
    isWet: boolean;
    wetTimer: number;
    isElectrified: boolean;
    // Player Specific
    invulnTimer: number;
    moveTarget?: {x: number, y: number};
    // Visuals
    hitFlashTimer: number;
}

type Bullet = Container & {
    vx: number;
    vy: number;
    damage: number;
    element: ElementType;
    duration: number;
    radius: number;
    ownerId: string;
    isDead: boolean;
    // Specific logic
    isTracking?: boolean;
    target?: Entity;
    pierce: number;
    hitList: Set<number>; // Enemy IDs hit
    // Visuals
    trailTimer: number; // For spawning particle trails
    color: number; // For particle trails
}

type Particle = Graphics & {
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    isStatic: boolean; // Does it move?
}

type XPOrb = Graphics & {
    value: number;
    vx: number;
    vy: number;
}

interface DelayedAction {
    timer: number;
    action: () => void;
}

export class GameEngine {
    app: Application;
    canvas: HTMLCanvasElement;
    state: GameState = GameState.MENU;
    
    // Containers
    world: Container;
    
    // Entities
    player: Entity;
    enemies: Entity[] = [];
    bullets: Bullet[] = [];
    particles: Particle[] = [];
    xpOrbs: XPOrb[] = [];
    obstacles: Graphics[] = []; 

    // Game Logic
    stats: PlayerStats;
    wave: number = 1;
    waveTimer: number = 0; // Keeping for general time tracking if needed, but not for spawn
    gameTime: number = 0;
    
    // Wave Logic
    waveTotalEnemies: number = 0;
    waveEnemiesSpawned: number = 0;
    waveDelayTimer: number = 0;

    // Cutscene Logic
    preLevelUpTimer: number = 0;

    // Input
    mouse: { x: number, y: number } = { x: 0, y: 0 };
    
    // Performance
    damageTextPool: Text[] = []; // Simple pool idea, or just throttling
    damageTextTimer: number = 0;

    // Action Queue for "Double Trigger"
    delayedActions: DelayedAction[] = [];

    // Callbacks to React
    onUpdateStats: (stats: PlayerStats) => void;
    onGameStateChange: (state: GameState) => void;
    onBossWarning: (name: string) => void;

    // Config
    mapType: MapType = MapType.FIXED;
    
    constructor(
        canvas: HTMLCanvasElement, 
        onUpdateStats: (s: PlayerStats) => void,
        onGameStateChange: (s: GameState) => void,
        onBossWarning: (n: string) => void
    ) {
        this.canvas = canvas;
        this.app = new Application();

        this.onUpdateStats = onUpdateStats;
        this.onGameStateChange = onGameStateChange;
        this.onBossWarning = onBossWarning;

        // Init Stats
        this.stats = {
            hp: 100,
            maxHp: 100,
            level: 1,
            xp: 0,
            nextLevelXp: 10,
            speed: 5,
            damageMultiplier: 1,
            pickupRange: 100,
            inventory: []
        };

        // Add initial weapon
        this.addInitialWeapon();
        
        // Placeholders to satisfy TS, real init in init()
        this.world = new Container(); 
        this.player = new Container() as Entity; 
    }

    async init() {
        await this.app.init({
            canvas: this.canvas,
            width: SCREEN_WIDTH,
            height: SCREEN_HEIGHT,
            backgroundColor: 0x1a1a2e,
            antialias: false,
            resolution: window.devicePixelRatio || 1,
        });

        // Init Containers
        this.world = new Container();
        this.app.stage.addChild(this.world);
        
        this.world.sortableChildren = true;

        // Init Player
        this.player = this.createPlayer();
        this.world.addChild(this.player);

        // Bind Inputs
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('mousemove', this.handleMouseMove);
        window.addEventListener('mousedown', this.handleMouseDown);

        // Start Loop
        this.app.ticker.add(this.update.bind(this));
    }

    addInitialWeapon() {
        // Initial generic projectile
        const starter: CardDef = {
            id: 'starter',
            name: '初始法球',
            description: '基础攻击',
            type: CardType.ARTIFACT,
            rarity: Rarity.SILVER,
            iconColor: '#00ffff',
            artifactConfig: {
                cooldown: 50,
                baseDamage: 4, 
                element: ElementType.PHYSICAL,
                projectileType: 'projectile',
                color: 0x00ffff
            }
        };
        this.stats.inventory.push(starter);
    }

    createPlayer(): Entity {
        const cont = new Container() as Entity;
        
        const g = new Graphics();
        
        // --- Pixel Art: Wizard ---
        // Body (Blue Robe)
        g.rect(-6, -8, 12, 16).fill(0x3b82f6); 
        // Hood/Head shadow
        g.rect(-6, -12, 12, 4).fill(0x1d4ed8);
        // Face
        g.rect(-4, -10, 8, 4).fill(0xffccaa);
        // Belt
        g.rect(-6, 0, 12, 2).fill(0xfca5a5);
        // Staff (Brown)
        g.rect(6, -10, 2, 20).fill(0x78350f);
        // Staff Gem (Red)
        g.rect(5, -12, 4, 4).fill(0xef4444);

        cont.addChild(g);
        cont.x = SCREEN_WIDTH / 2;
        cont.y = SCREEN_HEIGHT / 2;
        cont.vx = 0;
        cont.vy = 0;
        cont.hp = 100;
        cont.maxHp = 100;
        cont.radius = 12; // Hitbox radius
        cont.isDead = false;
        cont.zIndex = 100;
        cont.invulnTimer = 0;
        cont.hitFlashTimer = 0;

        return cont;
    }

    start(mapType: MapType) {
        this.mapType = mapType;
        this.state = GameState.PLAYING;
        
        // Init Wave Data
        this.wave = 1;
        this.waveEnemiesSpawned = 0;
        this.waveTotalEnemies = 15; // Start with manageable amount
        this.waveDelayTimer = 0;

        this.generateMap();
        this.onGameStateChange(GameState.PLAYING);
    }

    generateMap() {
        // Generate random obstacles
        for (let i = 0; i < 50; i++) {
            const obs = new Graphics();
            const type = Math.random();
            if (type < 0.3) {
                // Pixel Tree
                obs.rect(-4, 0, 8, 12).fill(0x5c4033); // Trunk
                obs.rect(-12, -24, 24, 24).fill(0x228b22); // Leaves
            } else if (type < 0.6) {
                // Pixel Rock
                obs.rect(-10, -5, 20, 10).fill(0x555555);
                obs.rect(-5, -10, 10, 5).fill(0x777777);
            } else {
                // Wall Segment
                obs.rect(-10, -30, 20, 60).fill(0x8b4513);
            }
            
            const range = this.mapType === MapType.FIXED ? 1000 : 3000;
            obs.x = (Math.random() - 0.5) * 2 * range + SCREEN_WIDTH/2;
            obs.y = (Math.random() - 0.5) * 2 * range + SCREEN_HEIGHT/2;
            
            this.obstacles.push(obs);
            this.world.addChild(obs);
        }
    }

    handleKeyDown = (e: KeyboardEvent) => {
        if (e.code === 'Escape') {
            if (this.state === GameState.PLAYING) {
                this.state = GameState.PAUSED;
                this.onGameStateChange(GameState.PAUSED);
            } else if (this.state === GameState.PAUSED) {
                this.state = GameState.PLAYING;
                this.onGameStateChange(GameState.PLAYING);
            }
        }
    }

    handleMouseMove = (e: MouseEvent) => {
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
    }

    handleMouseDown = (e: MouseEvent) => {
        if (this.state !== GameState.PLAYING) return;
        
        // Click to move logic
        // Transform screen coords to world coords
        const worldX = (e.clientX - SCREEN_WIDTH/2) + this.player.x;
        const worldY = (e.clientY - SCREEN_HEIGHT/2) + this.player.y;
        
        this.player.moveTarget = { x: worldX, y: worldY };
        
        // Spawn small click indicator
        const marker = new Graphics();
        marker.rect(-2, -2, 4, 4).fill(0xffffff);
        marker.x = worldX;
        marker.y = worldY;
        this.world.addChild(marker);
        setTimeout(() => marker.parent?.removeChild(marker), 300);
    }

    update(ticker: Ticker) {
        const delta = ticker.deltaTime;
        
        // Always update particles for visuals, even in pre-level-up
        this.updateParticles(delta);

        if (this.state === GameState.PRE_LEVEL_UP) {
            // Cutscene Logic
            this.preLevelUpTimer -= delta;
            
            // Spawn fancy upward particles
            if (Math.random() < 0.3) {
                 this.spawnParticle(
                     this.player.x + (Math.random()-0.5)*30, 
                     this.player.y + 10, 
                     0xffd700, 
                     1, 
                     true // Upward flow
                 );
            }

            // Camera still follows player slightly
            this.world.pivot.x = this.player.x;
            this.world.pivot.y = this.player.y;
            this.world.position.x = SCREEN_WIDTH / 2;
            this.world.position.y = SCREEN_HEIGHT / 2;

            if (this.preLevelUpTimer <= 0) {
                this.triggerLevelUpUI();
            }
            return;
        }

        if (this.state !== GameState.PLAYING) return;
        
        this.gameTime += delta;

        // Process delayed actions (for Double Trigger effects)
        for (let i = this.delayedActions.length - 1; i >= 0; i--) {
            this.delayedActions[i].timer -= delta;
            if (this.delayedActions[i].timer <= 0) {
                this.delayedActions[i].action();
                this.delayedActions.splice(i, 1);
            }
        }
        
        // --- 1. Player Movement (Click to Move) ---
        this.updatePlayerMovement(delta);

        // --- 2. Camera Follow ---
        this.world.pivot.x = this.player.x;
        this.world.pivot.y = this.player.y;
        this.world.position.x = SCREEN_WIDTH / 2;
        this.world.position.y = SCREEN_HEIGHT / 2;

        // --- 3. Spawning ---
        this.handleSpawning(delta);

        // --- 4. Weapon Firing ---
        this.handleWeapons(delta);

        // --- 5. Entity Updates ---
        this.updateEnemies(delta);
        this.updateBullets(delta);
        this.updateXP(delta);

        // --- 6. Collision ---
        this.handleCollisions(delta);

        // --- 7. Stats to React ---
        if (Math.floor(this.gameTime) % 15 === 0) {
            this.onUpdateStats({ ...this.stats, hp: this.player.hp, maxHp: this.player.maxHp });
        }
    }

    updatePlayerMovement(delta: number) {
        if (this.player.invulnTimer > 0) {
            this.player.invulnTimer -= delta;
            this.player.alpha = 0.5; // Flash effect
        } else {
            this.player.alpha = 1;
        }

        if (this.player.moveTarget) {
            const dx = this.player.moveTarget.x - this.player.x;
            const dy = this.player.moveTarget.y - this.player.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist > 5) {
                // Move towards target
                const speed = this.stats.speed * delta; // Normalize by delta
                this.player.x += (dx / dist) * speed;
                this.player.y += (dy / dist) * speed;
            } else {
                // Arrived
                this.player.moveTarget = undefined;
            }
        }
    }

    handleSpawning(delta: number) {
        // If between waves
        if (this.waveDelayTimer > 0) {
            this.waveDelayTimer -= delta;
            if (this.waveDelayTimer <= 0) {
                // Start next wave
                this.wave++;
                this.waveEnemiesSpawned = 0;
                this.waveTotalEnemies = Math.floor(10 + this.wave * 2.5); // Linear scaling
                
                if (this.wave % 10 === 0) {
                    this.onBossWarning(`Level ${this.wave} BOSS`);
                    this.spawnEnemy(true);
                    this.waveEnemiesSpawned++;
                } else {
                    this.spawnText(`WAVE ${this.wave}`, this.player.x, this.player.y - 100, 0xffffff);
                }
            }
            return;
        }

        // Check for wave clear
        if (this.waveEnemiesSpawned >= this.waveTotalEnemies && this.enemies.length === 0) {
            // Wave Cleared!
            this.waveDelayTimer = 120; // 2 seconds delay
            return;
        }

        // Spawning logic
        if (this.waveEnemiesSpawned < this.waveTotalEnemies) {
             // Cap concurrent enemies slightly to prevent lag, but allow most
             if (this.enemies.length < 50) {
                 // Spawn rate: Increases slightly with wave
                 const chance = 0.02 + (this.wave * 0.002);
                 if (Math.random() < chance) {
                     this.spawnEnemy(false);
                     this.waveEnemiesSpawned++;
                 }
             }
        }
    }

    spawnEnemy(isBoss: boolean) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 600 + Math.random() * 200; 
        const x = this.player.x + Math.cos(angle) * dist;
        const y = this.player.y + Math.sin(angle) * dist;

        const cont = new Container() as Entity;
        const g = new Graphics();
        
        // --- Pixel Art: Monsters ---
        if (isBoss) {
            // Boss: Big Ogre
            const color = 0xef4444; // Red
            g.rect(-20, -25, 40, 50).fill(color); // Body
            g.rect(-15, -15, 10, 10).fill(0xffff00); // Eye L
            g.rect(5, -15, 10, 10).fill(0xffff00); // Eye R
            g.rect(-10, 10, 20, 5).fill(0x000000); // Mouth
            g.rect(-25, -5, 5, 20).fill(0x7f1d1d); // Arm L
            g.rect(20, -5, 5, 20).fill(0x7f1d1d); // Arm R
        } else {
            // Minions
            const type = Math.floor(Math.random() * 3);
            if (type === 0) {
                // Goblin (Green)
                g.rect(-6, -6, 12, 12).fill(0x10b981);
                g.rect(-4, -4, 2, 2).fill(0x000000); // Eye
                g.rect(2, -4, 2, 2).fill(0x000000); // Eye
                g.rect(-8, -2, 2, 4).fill(0x059669); // Ear
                g.rect(6, -2, 2, 4).fill(0x059669); // Ear
            } else if (type === 1) {
                // Slime (Cyan)
                g.rect(-6, -4, 12, 8).fill(0x06b6d4);
                g.rect(-5, -6, 10, 2).fill(0x06b6d4); // Top round
                g.rect(-2, -2, 2, 2).fill(0xffffff); // Glint
            } else {
                // Bat (Purple)
                g.rect(-4, -4, 8, 8).fill(0x8b5cf6);
                g.rect(-8, -6, 4, 4).fill(0x6d28d9); // Wing
                g.rect(4, -6, 4, 4).fill(0x6d28d9); // Wing
            }
        }

        cont.addChild(g);
        cont.x = x;
        cont.y = y;
        
        // Balance: Lower scaling so it doesn't become impossible
        // Old: Math.pow(this.wave, 1.1)
        // New: 5 + wave * 1.5. Linear.
        const waveHP = 5 + (this.wave * 1.5);
        cont.maxHp = isBoss ? 300 + (this.wave * 10) : waveHP;
        
        cont.hp = cont.maxHp;
        cont.radius = isBoss ? 25 : 10;
        cont.isDead = false;
        cont.vx = 0; 
        cont.vy = 0;
        
        cont.isBurning = false;
        cont.isWet = false;
        cont.isElectrified = false;
        cont.burnTimer = 0;
        cont.wetTimer = 0;
        cont.hitFlashTimer = 0;

        this.enemies.push(cont);
        this.world.addChild(cont);
    }

    handleWeapons(delta: number) {
        let modifiers: { logic: string, count: number }[] = [];
        let buffStats = {
            rangeMult: 1,
            speedMult: 1,
            freqMult: 1
        };

        for (const card of this.stats.inventory) {
            if (card.type === CardType.EFFECT && card.effectConfig) {
                modifiers.push({ 
                    logic: card.effectConfig.logic, 
                    count: card.effectConfig.influenceCount 
                });
            } else if (card.type === CardType.BUFF && card.buffConfig) {
                if (card.buffConfig.range) buffStats.rangeMult += card.buffConfig.range;
                if (card.buffConfig.speed) buffStats.speedMult += card.buffConfig.speed;
                if (card.buffConfig.frequency) buffStats.freqMult += card.buffConfig.frequency;
            } else if (card.type === CardType.ARTIFACT && card.artifactConfig) {
                if (!this.weaponCooldowns[card.id]) this.weaponCooldowns[card.id] = 0;
                
                this.weaponCooldowns[card.id] -= delta * buffStats.freqMult;

                if (this.weaponCooldowns[card.id] <= 0) {
                    this.triggerArtifact(card, modifiers, buffStats);
                    this.weaponCooldowns[card.id] = card.artifactConfig.cooldown;
                }

                modifiers = modifiers.map(m => ({ ...m, count: m.count - 1 })).filter(m => m.count > 0);
                buffStats = { rangeMult: 1, speedMult: 1, freqMult: 1 };
            }
        }
    }

    triggerArtifact(card: CardDef, modifiers: { logic: string }[], buffs: any) {
        let double = false;
        modifiers.forEach(m => {
            if (m.logic === 'double') double = true;
        });

        // Fire first shot immediately
        this.executeCardLogic(card, modifiers, buffs);

        // If double effect, schedule a second shot with delay
        if (double) {
            this.delayedActions.push({
                timer: 15, // 15 frames delay (~0.25s at 60fps)
                action: () => {
                    this.executeCardLogic(card, modifiers, buffs);
                }
            });
        }
    }

    executeCardLogic(card: CardDef, modifiers: { logic: string }[], buffs: any) {
        if (!card.artifactConfig) return;
        const conf = card.artifactConfig;

        // Fix: Orbiting Sword Check (Prevent Duplicates)
        if (conf.projectileType === 'orbit') {
            const alreadyActive = this.bullets.some(b => b.ownerId === card.id && !b.isDead);
            if (alreadyActive) return; // Do not spawn another if one is orbiting
        }
        
        let isFan = false;
        let isRing = false;
        let isBack = false;
        let track = false;

        modifiers.forEach(m => {
            if (m.logic === 'split_back') isBack = true;
            if (m.logic === 'fan') isFan = true;
            if (m.logic === 'ring') isRing = true;
            if (m.logic === 'track') track = true;
        });

        // Aim at mouse (screen to relative)
        const dx = this.mouse.x - (SCREEN_WIDTH / 2);
        const dy = this.mouse.y - (SCREEN_HEIGHT / 2);
        let baseAngle = Math.atan2(dy, dx);
        
        let projectileCount = 1;
        if (isFan) projectileCount = 5;
        if (isRing) projectileCount = 12;

        const angles: number[] = [];
        
        if (isRing) {
            for(let i=0; i<projectileCount; i++) angles.push(baseAngle + (Math.PI * 2 * i / projectileCount));
        } else if (isFan) {
            for(let i=0; i<projectileCount; i++) angles.push(baseAngle + (i - 2) * 0.3);
        } else {
            angles.push(baseAngle);
        }

        if (isBack) {
            angles.push(baseAngle + Math.PI);
        }

        angles.forEach(angle => {
            this.createBullet(conf, angle, buffs, track, card.id);
        });
    }

    createBullet(conf: any, angle: number, buffs: any, tracking: boolean, ownerId: string) {
        const b = new Container() as Bullet;
        const g = new Graphics();
        
        // --- Visuals ---
        
        let speed = 5 * buffs.speedMult;
        let life = 180 * buffs.rangeMult; 
        
        if (conf.projectileType === 'projectile') {
            g.circle(0,0, 4).fill(0xffffff); // Core
            g.circle(0,0, 8).fill({ color: conf.color, alpha: 0.6 }); // Glow
            g.blendMode = 'add';
        } else if (conf.projectileType === 'beam') {
            g.rect(0, -5, 40, 10).fill(conf.color);
            g.blendMode = 'add';
            speed = 10 * buffs.speedMult;
        } else if (conf.projectileType === 'area') {
            // Wind/Area visual improvement
            if (conf.element === ElementType.WIND) {
                const r = 100 * buffs.rangeMult;
                g.arc(0,0, r, -0.5, 0.5).stroke({width: 2, color: 0xccffcc, alpha: 0.5});
                g.arc(0,0, r*0.7, -0.2, 0.8).stroke({width: 2, color: 0xffffff, alpha: 0.3});
            } else {
                g.moveTo(0,0);
                g.arc(0,0, 100 * buffs.rangeMult, -0.5, 0.5); 
                g.lineTo(0,0);
                g.fill({ color: conf.color, alpha: 0.5 });
            }
            g.blendMode = 'add';
            life = 10; 
            speed = 0; 
            if (conf.element === ElementType.FIRE) speed = 3; 
            if (conf.element === ElementType.WIND) speed = 3;
        } else if (conf.projectileType === 'orbit') {
            g.rect(-5, -20, 10, 40).fill(conf.color); 
            speed = 0;
            life = 9999; 
        } else if (conf.projectileType === 'lightning') {
            speed = 0;
            life = 5;
        }
        
        b.addChild(g);
        
        // Position
        b.x = this.player.x;
        b.y = this.player.y;

        b.vx = Math.cos(angle) * speed;
        b.vy = Math.sin(angle) * speed;
        b.rotation = angle;
        
        b.damage = conf.baseDamage * this.stats.damageMultiplier;
        b.element = conf.element;
        b.duration = life;
        b.radius = 12;
        b.ownerId = ownerId;
        b.isDead = false;
        b.isTracking = tracking;
        b.hitList = new Set();
        b.pierce = (conf.projectileType === 'area' || conf.projectileType === 'orbit') ? 999 : 1;
        
        // Particle Trail Config
        b.color = conf.color;
        b.trailTimer = 0;

        this.bullets.push(b);
        this.world.addChild(b);
    }

    // --- ENEMY LOGIC & WEAPON COOLDOWNS ---
    weaponCooldowns: { [key: string]: number } = {};

    updateEnemies(delta: number) {
        const playerPos = { x: this.player.x, y: this.player.y };
        
        this.enemies.forEach(e => {
            if (e.isDead) return;

            // Hit Flash Logic
            if (e.hitFlashTimer > 0) {
                e.hitFlashTimer -= delta;
                e.tint = 0xff0000;
            } else {
                e.tint = 0xffffff;
            }

            const dx = playerPos.x - e.x;
            const dy = playerPos.y - e.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist > 10) {
                // Base speed + slight wave scaling
                const moveSpeed = (1 + (this.wave * 0.005)) * delta;
                e.x += (dx / dist) * moveSpeed;
                e.y += (dy / dist) * moveSpeed;
            }

            if (e.isBurning) {
                e.hp -= 0.1 * delta;
                // Reduce burn particle freq
                if (Math.random() < 0.1) this.spawnParticle(e.x, e.y, 0xff4500);
            }

            if (e.hp <= 0) this.killEnemy(e);
        });

        this.enemies = this.enemies.filter(e => !e.isDead);
    }

    updateBullets(delta: number) {
        this.bullets.forEach(b => {
            if (b.isDead) return;
            b.duration -= delta;
            
            if (b.duration <= 0) {
                b.isDead = true;
                b.parent?.removeChild(b);
                return;
            }

            // Particle Trails (Replaces old line trail)
            // Spawn a particle every 3 frames if it's a moving projectile
            if (b.vx !== 0 || b.vy !== 0) {
                b.trailTimer -= delta;
                if (b.trailTimer <= 0) {
                    this.spawnParticle(b.x, b.y, b.color, 1);
                    b.trailTimer = 3; 
                }
            }

            if (b.ownerId.includes('art_sword_orbit')) { // Loose check for id as ownerId might be generated
                // Orbit Logic
                b.rotation += 0.1 * delta;
                b.x = this.player.x + Math.cos(b.rotation) * 100;
                b.y = this.player.y + Math.sin(b.rotation) * 100;
            } else if (b.isTracking) {
                let nearest = null;
                let minDst = 1000;
                // Optimized search
                for (const e of this.enemies) {
                    const d = Math.hypot(e.x - b.x, e.y - b.y);
                    if (d < minDst) { minDst = d; nearest = e; }
                }
                if (nearest) {
                    const angle = Math.atan2(nearest.y - b.y, nearest.x - b.x);
                    // Slight turn speed
                    b.vx = b.vx * 0.9 + Math.cos(angle) * 1;
                    b.vy = b.vy * 0.9 + Math.sin(angle) * 1;
                    // Normalize to max speed? Or just let it drift.
                }
                b.x += b.vx * delta;
                b.y += b.vy * delta;
            } else {
                b.x += b.vx * delta;
                b.y += b.vy * delta;
            }
        });
        this.bullets = this.bullets.filter(b => !b.isDead);
    }

    updateParticles(delta: number) {
        this.particles.forEach(p => {
            if (!p.isStatic) {
                p.x += p.vx * delta;
                p.y += p.vy * delta;
            }
            p.alpha -= 0.03 * delta;
            p.scale.x *= 0.95; // Shrink
            p.scale.y *= 0.95;
            p.life -= delta;
            
            if (p.life <= 0 || p.alpha <= 0) {
                p.parent?.removeChild(p);
            }
        });
        this.particles = this.particles.filter(p => p.life > 0 && p.alpha > 0);
    }

    updateXP(delta: number) {
        this.xpOrbs.forEach(orb => {
            const dx = this.player.x - orb.x;
            const dy = this.player.y - orb.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (dist < this.stats.pickupRange) {
                orb.x += (dx/dist) * 8 * delta;
                orb.y += (dy/dist) * 8 * delta;
                
                if (dist < 10) {
                    this.stats.xp += orb.value;
                    orb.parent?.removeChild(orb);
                    if (this.stats.xp >= this.stats.nextLevelXp) {
                        this.startLevelUpSequence();
                    }
                }
            }
        });
        this.xpOrbs = this.xpOrbs.filter(o => o.parent);
    }

    handleCollisions(delta: number) {
        // Player vs Enemy Collision (Contact Damage)
        if (this.player.invulnTimer <= 0) {
            for (const e of this.enemies) {
                 const dx = this.player.x - e.x;
                 const dy = this.player.y - e.y;
                 const dist = Math.sqrt(dx * dx + dy * dy);
                 if (dist < (this.player.radius + e.radius)) {
                     // Hit
                     this.player.hp -= 5 + (this.wave * 0.5); // Damage scales slowly
                     this.player.invulnTimer = 30; // 0.5s i-frame
                     this.spawnText("-HP", this.player.x, this.player.y - 30, 0xff0000);
                     if (this.player.hp <= 0) {
                         this.player.hp = 0;
                         this.state = GameState.GAME_OVER;
                         this.onGameStateChange(GameState.GAME_OVER);
                     }
                     break; // One hit per frame max
                 }
            }
        }

        // Bullet vs Enemy
        for (const b of this.bullets) {
            if (b.isDead) continue;
            for (const e of this.enemies) {
                if (e.isDead) continue;
                if (b.hitList.has(this.getObjectId(e))) continue;

                const dx = b.x - e.x;
                const dy = b.y - e.y;
                const dist = Math.sqrt(dx*dx + dy*dy);

                if (dist < (b.radius + e.radius)) {
                    this.applyDamage(e, b);
                    b.hitList.add(this.getObjectId(e));
                    
                    b.pierce--;
                    if (b.pierce <= 0) {
                        b.isDead = true;
                        b.parent?.removeChild(b);
                        break; 
                    }
                }
            }
        }
    }

    getObjectId(obj: any): number {
        if (!obj._tempId) obj._tempId = Math.random();
        return obj._tempId;
    }

    damageTextCooldown = 0;

    applyDamage(e: Entity, b: Bullet) {
        let dmg = b.damage;

        e.hitFlashTimer = 5; // Flash for 5 frames

        // --- Wind Knockback ---
        if (b.element === ElementType.WIND) {
            const angle = Math.atan2(e.y - b.y, e.x - b.x);
            // Strong push
            e.x += Math.cos(angle) * 30; 
            e.y += Math.sin(angle) * 30;
        }

        if (b.element === ElementType.FIRE) {
            e.isBurning = true;
            if (e.isWet) { 
                e.isBurning = false; 
                this.spawnText("Extinguish", e.x, e.y, 0xaaaaff);
            }
        }

        if (b.element === ElementType.WATER) {
            e.isWet = true;
            const angle = Math.atan2(e.y - b.y, e.x - b.x);
            e.x += Math.cos(angle) * 20; // Water mild push
            e.y += Math.sin(angle) * 20;
            
            if (e.isBurning) {
                e.isBurning = false; 
                dmg *= 0.5; 
            }
        }

        if (b.element === ElementType.LIGHTNING) {
            if (e.isWet) {
                this.triggerChainLightning(e, dmg);
                this.spawnText("CHAIN!", e.x, e.y, 0xffff00);
            }
            if (e.isBurning) {
                dmg *= 2; 
                e.isBurning = false;
                this.spawnText("EXPLODE!", e.x, e.y, 0xffaa00);
                this.spawnParticle(e.x, e.y, 0xffaa00, 10);
            }
        }

        e.hp -= dmg;

        // Visual impact particles
        this.spawnParticle(e.x, e.y, b.color, 3);

        // Optimization: Don't spawn text on every single hit if laggy
        this.damageTextCooldown--;
        if (this.damageTextCooldown <= 0 || dmg > 10) { // Always show high dmg
            this.spawnText(Math.round(dmg).toString(), e.x, e.y - 20, 0xffffff);
            this.damageTextCooldown = 2; // Throttle
        }
    }

    triggerChainLightning(source: Entity, dmg: number) {
        if (this.enemies.length > 200) return; 

        this.enemies.forEach(target => {
            if (target === source) return;
            const d = Math.hypot(target.x - source.x, target.y - source.y);
            if (d < 100) {
                target.hp -= dmg * 0.5;
                const g = new Graphics();
                g.moveTo(source.x, source.y);
                g.lineTo(target.x, target.y);
                g.stroke({ width: 2, color: 0xffff00 }); 
                this.world.addChild(g);
                setTimeout(() => g.parent?.removeChild(g), 100);
            }
        });
    }

    killEnemy(e: Entity) {
        e.isDead = true;
        this.world.removeChild(e);
        
        const orb = new Graphics() as XPOrb;
        let color = 0x888888;
        let size = 6;
        const val = 1 + (this.wave * 0.5);
        
        if (this.wave > 10) { color = 0x00ff00; size = 8; }
        if (this.wave > 30) { color = 0x00ffff; size = 10; } // Cyan
        if (this.wave > 80) { color = 0xffd700; size = 12; } // Gold

        // Diamond Shape for better visibility
        orb.poly([
            0, -size,
            size, 0,
            0, size,
            -size, 0
        ]).fill(color);

        orb.x = e.x;
        orb.y = e.y;
        orb.value = val;
        
        this.xpOrbs.push(orb);
        this.world.addChild(orb);

        if (this.wave === 100 && e.maxHp > 10000) { 
            this.state = GameState.VICTORY;
            this.onGameStateChange(GameState.VICTORY);
        }
    }

    startLevelUpSequence() {
        this.state = GameState.PRE_LEVEL_UP;
        this.preLevelUpTimer = 90; // 1.5 seconds at 60fps
        this.onGameStateChange(GameState.PRE_LEVEL_UP);
        
        // Spawn Big Text
        this.spawnText("LEVEL UP!", this.player.x, this.player.y - 50, 0xffd700);
    }

    triggerLevelUpUI() {
        this.state = GameState.LEVEL_UP;
        this.onGameStateChange(GameState.LEVEL_UP);
        this.stats.level++;
        this.stats.xp = 0;
        this.stats.nextLevelXp = Math.floor(this.stats.nextLevelXp * 1.5);
    }

    spawnText(text: string, x: number, y: number, color: number) {
        // Optimization check
        if (this.app.ticker.FPS < 40 && Math.random() > 0.5) return;

        const t = new Text({
            text: text,
            style: {
                fontFamily: 'PixelFont',
                fontSize: 14,
                fill: color,
                stroke: { color: 0x000000, width: 2 },
                align: 'center'
            }
        });
        t.x = x;
        t.y = y;
        this.world.addChild(t);
        let tick = 0;
        const anim = (ticker: Ticker) => {
            tick++;
            t.y -= 1;
            t.alpha -= 0.02;
            if (tick > 50) {
                this.app.ticker.remove(anim);
                t.parent?.removeChild(t);
            }
        };
        this.app.ticker.add(anim);
    }

    spawnParticle(x: number, y: number, color: number, count = 3, upward = false) {
        if (this.app.ticker.FPS < 30) return; // Skip particles on low FPS

        for(let i=0; i<count; i++) {
            const p = new Graphics() as Particle;
            p.circle(0,0, 3).fill(color);
            p.x = x;
            p.y = y;
            if (upward) {
                p.vx = (Math.random()-0.5) * 2;
                p.vy = -Math.random() * 3 - 1; // Always up
            } else {
                p.vx = (Math.random()-0.5) * 4;
                p.vy = (Math.random()-0.5) * 4;
            }
            p.life = 30;
            p.maxLife = 30;
            p.isStatic = false;
            p.blendMode = 'add'; // GLOW
            
            this.particles.push(p);
            this.world.addChild(p);
        }
    }

    addCard(card: CardDef) {
        if (card.type === CardType.STAT && card.statBonus) {
            if (card.statBonus.hpPercent) this.stats.maxHp *= (1 + card.statBonus.hpPercent);
            if (card.statBonus.dmgPercent) this.stats.damageMultiplier *= (1 + card.statBonus.dmgPercent);
            if (card.statBonus.pickupPercent) this.stats.pickupRange *= (1 + card.statBonus.pickupPercent);
        } else {
            this.stats.inventory.push(card);
        }
    }

    reorderInventory(newOrder: CardDef[]) {
        this.stats.inventory = newOrder;
    }

    resume() {
        this.state = GameState.PLAYING;
    }

    destroy() {
        try {
            this.app.destroy({ removeView: true } as any);
        } catch(e) { console.error(e) }
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('mousemove', this.handleMouseMove);
        window.removeEventListener('mousedown', this.handleMouseDown);
    }
}