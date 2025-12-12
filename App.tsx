
import React, { useEffect, useRef, useState } from 'react';
import { GameEngine } from './engine';
import { GameState, MapType, PlayerStats, CardDef, CardType, Rarity } from './types';
import { getRandomCard, ALL_CARDS } from './constants';
import Muuri from 'muuri';

// Extend window for gm
declare global {
    interface Window {
        gm: () => void;
    }
}

const App = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [gameState, setGameState] = useState<GameState>(GameState.MENU);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [levelUpOptions, setLevelUpOptions] = useState<CardDef[]>([]);
  const [bossWarning, setBossWarning] = useState<string | null>(null);
  const [aimStatus, setAimStatus] = useState<string>("自动");
  const [selectedCard, setSelectedCard] = useState<CardDef | null>(null);
  const [isGmMode, setIsGmMode] = useState(false);
  
  // Muuri Grid Ref
  const gridRef = useRef<Muuri | null>(null);
  const gridElementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
     window.gm = () => {
         setIsGmMode(prev => !prev);
     };
  }, []);

  // Initialize Engine
  useEffect(() => {
    if (!canvasRef.current) return;
    
    if (engineRef.current) return;

    const engine = new GameEngine(
      canvasRef.current,
      (newStats) => setStats({...newStats}), 
      (newState) => {
          setGameState(newState);
          if (newState === GameState.LEVEL_UP) {
              const wave = engineRef.current?.wave || 1;
              const inv = engineRef.current?.stats.inventory || [];
              const opts: CardDef[] = [];
              
              for(let i=0; i<3; i++) {
                  const card = getRandomCard(wave, inv, opts); 
                  opts.push(card);
              }
              
              setLevelUpOptions(opts);
          }
      },
      (name) => {
          setBossWarning(name);
          setTimeout(() => setBossWarning(null), 3000);
      },
      (isAuto) => {
          setAimStatus(isAuto ? "自动" : "手动");
      }
    );
    engineRef.current = engine;
    
    const initEngine = async () => {
        try {
            await engine.init();
        } catch (e: any) {
            console.error("Engine Init Failed", e);
        }
    };
    
    initEngine();

    return () => {
      if (engineRef.current) {
          engineRef.current.destroy();
          engineRef.current = null;
      }
    };
  }, []);

  // Initialize Muuri when entering Pause state
  useEffect(() => {
    if (gameState === GameState.PAUSED && gridElementRef.current && !gridRef.current) {
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
            
            gridRef.current.on('dragEnd', () => {
               syncInventoryFromMuuri(); 
            });

        }, 100);
    }

    return () => {
        if (gameState !== GameState.PAUSED && gridRef.current) {
            gridRef.current.destroy();
            gridRef.current = null;
        }
    };
  }, [gameState]);

  const syncInventoryFromMuuri = () => {
      if (!gridRef.current || !engineRef.current || !stats) return;
      
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
          setStats({ ...stats, inventory: newInventory });
      }
  }

  const startGame = (mapType: MapType) => {
    engineRef.current?.start(mapType);
  };

  const selectCardForInventory = (card: CardDef) => {
    // Clone to ensure unique ID if added from GM mode multiple times
    const newCard = { ...card, id: Math.random().toString(36).substr(2, 9) };
    engineRef.current?.addCard(newCard);
    
    if (gameState === GameState.LEVEL_UP) {
        engineRef.current?.resume();
        setGameState(GameState.PLAYING);
    } else {
        // GM Mode update stats immediately
        if (engineRef.current) {
           setStats({ ...engineRef.current.stats });
        }
    }
  };

  const gmRemoveCard = (index: number) => {
      engineRef.current?.debugRemoveCard(index);
      if (engineRef.current) setStats({ ...engineRef.current.stats });
  };

  const gmSetWave = (e: any) => {
      const w = parseInt(e.target.value);
      if (!isNaN(w)) {
          engineRef.current?.debugSetWave(w);
      }
  };

  const handleResume = () => {
      syncInventoryFromMuuri();
      if (stats) {
         engineRef.current?.reorderInventory(stats.inventory);
      }

      setGameState(GameState.PLAYING);
      engineRef.current?.resume();
      
      if (gridRef.current) {
          gridRef.current.destroy();
          gridRef.current = null;
      }
      setSelectedCard(null);
  };

  // Helper to determine Groups for rendering chain borders
  const calculateCardGroups = () => {
      if (!stats) return new Map<number, string>();
      
      const slotClasses = new Map<number, string>();
      let activeEffects: { count: number, id: string }[] = [];
      
      stats.inventory.forEach((card, index) => {
          // Identify if this card is affected by previous effects
          if (activeEffects.length > 0) {
              // Mark as affected
              slotClasses.set(index, (slotClasses.get(index) || "") + " chain-affected");
          }

          // Execution count logic (same as engine)
          let executionCount = 1;
          activeEffects.forEach(eff => {
              if (eff.id.includes('double')) executionCount *= 2;
          });
          executionCount = Math.min(executionCount, 4);

          // Add New Effects
          if (card.type === CardType.EFFECT && card.effectConfig) {
             slotClasses.set(index, (slotClasses.get(index) || "") + " chain-start"); // Source
             
             for(let i=0; i<executionCount; i++) {
                 activeEffects.push({
                     count: card.effectConfig.influenceCount,
                     id: card.id
                 });
             }
          }

          // Decrement Effects
          const isArtifact = card.type === CardType.ARTIFACT;
          activeEffects.forEach(eff => {
               if (eff.id.includes('double')) eff.count--;
               else if (isArtifact) eff.count--;
          });
          
          // Check for expired effects to mark this index as "chain-end" for that effect
          // This is purely visual approximation. 
          const justFinished = activeEffects.filter(eff => eff.count === 0);
          if (justFinished.length > 0) {
              slotClasses.set(index, (slotClasses.get(index) || "") + " chain-end");
          }

          activeEffects = activeEffects.filter(eff => eff.count > 0);
      });
      return slotClasses;
  };

  const slotClasses = calculateCardGroups();

  const renderInventory = () => {
      if (!stats) return null;

      return stats.inventory.map((card, index) => {
          const cls = slotClasses.get(index) || "";
          
          return (
            <div
                key={card.id}
                data-id={card.id}
                className={`inv-slot rarity-${card.rarity} ${cls}`}
                onClick={() => setSelectedCard(card)}
            >
                <div className="inv-slot-content w-full h-full flex items-center justify-center relative pointer-events-none">
                    {card.type === CardType.EFFECT && <span className="badge badge-effect">E</span>}
                    {card.type === CardType.BUFF && <span className="badge badge-buff">B</span>}
                    
                    <span style={{ color: card.iconColor, fontWeight: 'bold' }}>
                        {card.name.substring(0, 2)}
                    </span>
                </div>
            </div>
          );
      });
  }

  return (
    <div className="app-container">
      <style>{`
        /* Chain Grouping Visuals */
        .chain-start {
            border-left: 3px solid #a855f7 !important;
            border-top: 3px solid #a855f7 !important;
            border-bottom: 3px solid #a855f7 !important;
            border-right: none !important;
            border-top-right-radius: 0 !important;
            border-bottom-right-radius: 0 !important;
            margin-right: -2px !important;
            z-index: 5;
            box-shadow: -2px 0 10px rgba(168, 85, 247, 0.4);
        }
        .chain-affected {
            border-top: 3px solid #22d3ee !important;
            border-bottom: 3px solid #22d3ee !important;
            border-left: none !important;
            border-right: none !important;
            border-radius: 0 !important;
            margin-left: -2px !important;
            margin-right: -2px !important;
            background-color: rgba(34, 211, 238, 0.05);
            z-index: 4;
        }
        .chain-end {
            border-right: 3px solid #22d3ee !important;
            border-top: 3px solid #22d3ee !important;
            border-bottom: 3px solid #22d3ee !important;
            border-top-left-radius: 0 !important;
            border-bottom-left-radius: 0 !important;
            margin-left: -2px !important;
            z-index: 5;
        }
        /* Overrides for items that are both Start and End or Affected */
        .chain-start.chain-affected {
             border-top: 3px solid #a855f7 !important; /* purple overrides blue */
             border-bottom: 3px solid #a855f7 !important;
        }
      `}</style>
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
              开始游戏
            </button>
          </div>
          <div className="instructions mt-8 text-center">
            点击地面移动. 默认自动攻击最近敌人.<br/>
            按 [A] 键切换手动/自动瞄准.<br/>
            Esc 暂停/整理背包.<br/>
            (在控制台输入 gm() 开启调试模式)
          </div>
        </div>
      )}

      {/* --- HUD --- */}
      {(gameState === GameState.PLAYING || gameState === GameState.PRE_LEVEL_UP) && stats && (
        <div className="absolute inset-0 pointer-events-none p-4">
           {/* Aim Status */}
           <div className="aim-status">
               瞄准: {aimStatus} [A]
           </div>

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

      {/* --- GM PANEL --- */}
      {isGmMode && (
          <div className="gm-panel z-100 pointer-events-auto">
              <div className="gm-header flex justify-between">
                  <span>GM DEBUG PANEL</span>
                  <button className="btn-sm" onClick={() => setIsGmMode(false)}>X</button>
              </div>
              
              <div className="gm-section">
                  <div className="gm-label">Current Wave</div>
                  <input type="number" className="bg-gray-700 text-white p-1" onChange={gmSetWave} defaultValue={engineRef.current?.wave} />
              </div>

              <div className="gm-section">
                  <div className="gm-label">Add Card (Click to Add)</div>
                  <div className="gm-card-grid">
                      {ALL_CARDS.map(c => (
                          <button key={c.id} className="gm-card-btn" onClick={() => selectCardForInventory(c)}>
                              {c.name}
                          </button>
                      ))}
                  </div>
              </div>

              <div className="gm-section">
                  <div className="gm-label">Current Inventory (Click to Remove)</div>
                  <div className="gm-card-grid">
                      {stats?.inventory.map((c, i) => (
                          <button key={c.id} className="gm-card-btn btn-red" onClick={() => gmRemoveCard(i)}>
                              {i+1}. {c.name}
                          </button>
                      ))}
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
                onClick={() => selectCardForInventory(card)}
                className={`card rarity-${card.rarity}`}
              >
                <div className="card-icon">
                   <div style={{ color: card.iconColor }}>★</div>
                </div>
                <h3 className="card-name mb-2" style={{ color: card.iconColor }}>{card.name}</h3>
                <p className="card-desc">{card.description}</p>
                <div className="card-type">{card.type}</div>
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
             拖动卡片调整顺序。效果卡会与受影响卡片形成边框连接。<br/>
             <span className="text-purple-400">紫色起始</span>，<span className="text-cyan-400">青色范围</span>。
           </p>
           
           <div className="pause-layout">
               <div ref={gridElementRef} className="inv-grid">
                 {renderInventory()}
               </div>

               {/* Details Panel */}
               <div className="details-panel">
                   {selectedCard ? (
                       <>
                           <div className="details-title" style={{ color: selectedCard.iconColor }}>
                               {selectedCard.name}
                           </div>
                           <div className="details-type">{selectedCard.rarity} {selectedCard.type}</div>
                           <div className="details-desc">{selectedCard.description}</div>
                       </>
                   ) : (
                       <div className="text-gray-500 italic">点击卡片查看详情</div>
                   )}
               </div>
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
