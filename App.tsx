import React, { useEffect, useRef, useState } from 'react';
import { GameEngine } from './engine';
import { GameState, MapType, PlayerStats, CardDef, CardType, Rarity } from './types';
import { getRandomCard, STAT_CARDS, COLORS } from './constants';
import Muuri from 'muuri';

const App = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [gameState, setGameState] = useState<GameState>(GameState.MENU);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [levelUpOptions, setLevelUpOptions] = useState<CardDef[]>([]);
  const [bossWarning, setBossWarning] = useState<string | null>(null);
  
  // Muuri Grid Ref
  const gridRef = useRef<Muuri | null>(null);
  const gridElementRef = useRef<HTMLDivElement>(null);

  // Initialize Engine
  useEffect(() => {
    if (!canvasRef.current) return;
    
    // Prevent double initialization if engine already exists (Strict Mode)
    if (engineRef.current) return;

    const engine = new GameEngine(
      canvasRef.current,
      (newStats) => setStats({...newStats}), // Update stats
      (newState) => {
          setGameState(newState);
          if (newState === GameState.LEVEL_UP) {
              const wave = engineRef.current?.wave || 1;
              const inv = engineRef.current?.stats.inventory || [];
              const opts: CardDef[] = [];
              
              // Generate 3 unique options
              for(let i=0; i<3; i++) {
                  const card = getRandomCard(wave, inv, opts); // Pass existing options to exclude list
                  opts.push(card);
              }
              
              setLevelUpOptions(opts);
          }
      },
      (name) => {
          setBossWarning(name);
          setTimeout(() => setBossWarning(null), 3000);
      }
    );
    engineRef.current = engine;
    
    // Attempt initialization
    const initEngine = async () => {
        try {
            await engine.init();
        } catch (e: any) {
            console.error("Engine Init Failed", e);
        }
    };
    
    initEngine();

    return () => {
      // Clean up on unmount
      if (engineRef.current) {
          engineRef.current.destroy();
          engineRef.current = null;
      }
    };
  }, []);

  // Initialize Muuri when entering Pause state
  useEffect(() => {
    if (gameState === GameState.PAUSED && gridElementRef.current && !gridRef.current) {
        // Slight delay to ensure DOM is rendered
        setTimeout(() => {
            if (!gridElementRef.current) return;
            gridRef.current = new Muuri(gridElementRef.current, {
                dragEnabled: true,
                layout: {
                    fillGaps: true
                },
                dragSort: true,
                dragStartPredicate: {
                    distance: 10,
                    delay: 0,
                }
            });
        }, 100);
    }

    return () => {
        // Destroy Muuri when leaving Pause state or component unmounts
        if (gameState !== GameState.PAUSED && gridRef.current) {
            gridRef.current.destroy();
            gridRef.current = null;
        }
    };
  }, [gameState]);

  const startGame = (mapType: MapType) => {
    engineRef.current?.start(mapType);
  };

  const selectCard = (card: CardDef) => {
    engineRef.current?.addCard(card);
    engineRef.current?.resume();
    setGameState(GameState.PLAYING);
  };

  const handleResume = () => {
      // Sync Muuri order to GameState
      if (gridRef.current && stats) {
          const items = gridRef.current.getItems();
          const newInventory: CardDef[] = [];
          
          items.forEach(item => {
              const el = item.getElement();
              if (el) {
                  const id = el.getAttribute('data-id');
                  const card = stats.inventory.find(c => c.id === id);
                  if (card) newInventory.push(card);
              }
          });
          
          if (newInventory.length === stats.inventory.length) {
            engineRef.current?.reorderInventory(newInventory);
            setStats({ ...stats, inventory: newInventory });
          }
      }

      setGameState(GameState.PLAYING);
      engineRef.current?.resume();
      
      // Destroy Muuri explicitly
      if (gridRef.current) {
          gridRef.current.destroy();
          gridRef.current = null;
      }
  };

  // Render logic for inventory with Muuri compatibility
  const renderInventory = () => {
      if (!stats) return null;

      return stats.inventory.map((card) => (
          <div
             key={card.id}
             data-id={card.id}
             className="inv-slot group"
             style={{ borderColor: card.iconColor }}
           >
             <div className="inv-slot-content w-full h-full flex items-center justify-center relative">
                 {card.type === CardType.EFFECT && <span className="badge badge-effect">E</span>}
                 {card.type === CardType.BUFF && <span className="badge badge-buff">B</span>}
                 
                 <span style={{ color: card.iconColor, fontWeight: 'bold' }}>
                    {card.name.substring(0, 2)}
                 </span>
                 
                 {/* Hover Tooltip */}
                 <div className="tooltip">
                    <div className="font-bold" style={{ color: card.iconColor }}>{card.name}</div>
                    <div className="text-tiny">{card.description}</div>
                    <div className="text-tiny text-gray-400 mt-1 uppercase">{card.rarity}</div>
                 </div>
             </div>
           </div>
      ));
  }

  return (
    <div className="app-container">
      <canvas ref={canvasRef} className="absolute inset-0" />

      {/* --- MENU --- */}
      {gameState === GameState.MENU && (
        <div className="absolute inset-0 overlay-bg flex flex-col items-center justify-center gap-6">
          <h1 className="menu-title mb-8">元素幸存者</h1>
          <div className="flex flex-col gap-4">
            <button 
              onClick={() => startGame(MapType.FIXED)}
              className="btn btn-fixed"
            >
              固定地图 (Fixed Map)
            </button>
            <button 
              onClick={() => startGame(MapType.INFINITE)}
              className="btn btn-infinite"
            >
              无限地图 (Infinite Map)
            </button>
          </div>
          <div className="instructions mt-8 text-center">
            操作: 鼠标移动瞄准, 点击地面移动.<br/>
            Esc 暂停/整理背包.
          </div>
        </div>
      )}

      {/* --- HUD --- */}
      {(gameState === GameState.PLAYING || gameState === GameState.PRE_LEVEL_UP) && stats && (
        <div className="absolute inset-0 pointer-events-none p-4">
           {/* HP Bar */}
           <div className="bar-container bar-hp">
             <div 
               className="bar-fill fill-red" 
               style={{ width: `${Math.max(0, (stats.hp / stats.maxHp) * 100)}%` }} 
             />
             <span className="hp-text">
                {Math.ceil(Math.max(0, stats.hp))} / {Math.ceil(stats.maxHp)}
             </span>
           </div>
           
           {/* XP Bar */}
           <div className="bar-container bar-xp">
             <div 
               className="bar-fill fill-yellow" 
               style={{ width: `${(stats.xp / stats.nextLevelXp) * 100}%` }} 
             />
           </div>
           <div className="lvl-text">
             LV {stats.level}
           </div>

           {/* Wave Info */}
           <div className="wave-info">
             <div className="wave-title">WAVE {engineRef.current?.wave}</div>
             <div className="wave-timer">
                Left: {engineRef.current?.waveTotalEnemies && engineRef.current.waveEnemiesSpawned !== undefined 
                  ? Math.max(0, engineRef.current.waveTotalEnemies - engineRef.current.waveEnemiesSpawned + engineRef.current.enemies.length)
                  : 0}
             </div>
           </div>
        </div>
      )}

      {/* --- BOSS WARNING --- */}
      {bossWarning && (
         <div className="absolute inset-0 flex items-center justify-center pointer-events-none boss-overlay">
            <div className="boss-text">
               警告: {bossWarning}
            </div>
         </div>
      )}

      {/* --- LEVEL UP --- */}
      {gameState === GameState.LEVEL_UP && (
        <div className="absolute inset-0 overlay-darker flex flex-col items-center justify-center z-50">
          <h2 className="levelup-title mb-8">等级提升!</h2>
          <div className="flex gap-4">
            {levelUpOptions.map((card, i) => (
              <div 
                key={i}
                onClick={() => selectCard(card)}
                className={`card rarity-${card.rarity}`}
              >
                <div className="card-icon">
                   <div style={{ color: card.iconColor }}>★</div>
                </div>
                <h3 className="card-name mb-2" style={{ color: card.iconColor }}>{card.name}</h3>
                <p className="card-desc">{card.description}</p>
                <div className="card-type mt-auto">{card.type}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* --- PAUSE / INVENTORY --- */}
      {gameState === GameState.PAUSED && stats && (
         <div className="absolute inset-0 pause-overlay flex flex-col items-center justify-center z-40">
           <h2 className="pause-title mb-4">暂停 / 装备调整</h2>
           <p className="pause-desc mb-8">
             拖动卡片调整顺序。效果卡片(Effect)会影响排列在它后面的技能(Artifact)。<br/>
             例如: [双重触发] &rarr; [火葫芦] = 双倍火焰。
           </p>
           
           <div ref={gridElementRef} className="inv-grid gap-2">
             {renderInventory()}
           </div>

           <button 
             onClick={handleResume}
             className="btn-resume mt-8"
           >
             继续游戏
           </button>
         </div>
      )}

      {/* --- GAME OVER --- */}
      {gameState === GameState.GAME_OVER && (
          <div className="absolute inset-0 overlay-darker flex flex-col items-center justify-center z-50">
             <h1 className="text-red-500 text-6xl font-bold mb-4">GAME OVER</h1>
             <p className="text-white text-xl mb-8">你倒下了...</p>
             <button onClick={() => window.location.reload()} className="btn btn-fixed">
               重新开始
             </button>
          </div>
      )}

      {/* --- VICTORY --- */}
      {gameState === GameState.VICTORY && (
          <div className="absolute inset-0 victory-overlay flex flex-col items-center justify-center z-50">
             <h1 className="victory-title mb-8">胜利!</h1>
             <p className="victory-subtitle mb-8">你击败了终极 BOSS.</p>
             <div className="cast-box mb-8">
                <h3 className="cast-title mb-4">Cast</h3>
                <p>Producer: You</p>
                <p>Engine: Pixi.js</p>
                <p>UI: React</p>
                <p>Thank you for playing!</p>
             </div>
             <button onClick={() => window.location.reload()} className="btn-replay mt-8">再玩一次</button>
          </div>
      )}
    </div>
  );
};

export default App;