import React, { useEffect, useRef, useState } from 'react';
import { GameEngine } from './engine';
import { GameState, MapType, PlayerStats, CardDef, CardType } from './types';
import { getRandomCard, STAT_CARDS, COLORS } from './constants';

const App = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [gameState, setGameState] = useState<GameState>(GameState.MENU);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [levelUpOptions, setLevelUpOptions] = useState<CardDef[]>([]);
  const [bossWarning, setBossWarning] = useState<string | null>(null);
  
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
              // Generate 3 random cards, passing inventory for deduplication
              const wave = engineRef.current?.wave || 1;
              const inv = engineRef.current?.stats.inventory || [];
              const opts = [
                  getRandomCard(wave, inv), 
                  getRandomCard(wave, inv), 
                  getRandomCard(wave, inv)
              ];
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
            // If the error is the specific Pixi extension batcher error, it means
            // Pixi is likely already initialized in the global scope (hot reload/strict mode issue).
            // We can often safely ignore this in dev environments if the canvas attaches correctly.
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

  const startGame = (mapType: MapType) => {
    engineRef.current?.start(mapType);
  };

  const selectCard = (card: CardDef) => {
    engineRef.current?.addCard(card);
    engineRef.current?.resume();
    setGameState(GameState.PLAYING);
  };

  // Drag and Drop Logic for Pause Menu
  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData("index", index.toString());
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    const dragIndex = parseInt(e.dataTransfer.getData("index"));
    if (isNaN(dragIndex) || !stats) return;

    const newInv = [...stats.inventory];
    const [moved] = newInv.splice(dragIndex, 1);
    newInv.splice(dropIndex, 0, moved);
    
    engineRef.current?.reorderInventory(newInv);
    setStats({ ...stats, inventory: newInv });
  };

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

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
      {gameState === GameState.PLAYING && stats && (
        <div className="absolute inset-0 pointer-events-none p-4">
           {/* HP Bar */}
           <div className="bar-container bar-hp">
             <div 
               className="bar-fill fill-red" 
               style={{ width: `${(stats.hp / stats.maxHp) * 100}%` }} 
             />
             <span className="hp-text">
                {Math.ceil(stats.hp)} / {Math.ceil(stats.maxHp)}
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
               {Math.floor((engineRef.current?.gameTime || 0) / 60)}:
               {Math.floor((engineRef.current?.gameTime || 0) % 60).toString().padStart(2, '0')}
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
          <h2 className="levelup-title mb-8">等级提升! 选择强化</h2>
          <div className="flex gap-4">
            {levelUpOptions.map((card, i) => (
              <div 
                key={i}
                onClick={() => selectCard(card)}
                className="card"
                style={{ borderColor: card.iconColor }}
              >
                <div className="card-icon">
                   {/* Placeholder Icon */}
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
           
           <div className="inv-grid gap-2">
             {stats.inventory.map((card, index) => (
               <div
                 key={card.id}
                 draggable
                 onDragStart={(e) => handleDragStart(e, index)}
                 onDrop={(e) => handleDrop(e, index)}
                 onDragOver={handleDragOver}
                 className="inv-slot group"
                 style={{ borderColor: card.iconColor }}
                 title={card.name + "\n" + card.description}
               >
                 {card.type === CardType.EFFECT && <span className="badge badge-effect">E</span>}
                 {card.type === CardType.BUFF && <span className="badge badge-buff">B</span>}
                 {card.name.substring(0, 2)}
                 
                 {/* Hover Tooltip */}
                 <div className="tooltip">
                    <div className="font-bold">{card.name}</div>
                    <div className="text-tiny">{card.description}</div>
                 </div>
               </div>
             ))}
           </div>

           <button 
             onClick={() => {
                setGameState(GameState.PLAYING);
                engineRef.current?.resume();
             }}
             className="btn-resume mt-8"
           >
             继续游戏
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