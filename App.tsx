
import React, { useEffect, useRef, useState } from 'react';
import { GameEngine } from './engine';
import { GameState, MapType, PlayerStats, CardDef, CardType, Rarity } from './types';
import { getRandomCard, ALL_CARDS } from './constants';

// Extend window for gm
declare global {
    interface Window {
        gm: () => void;
    }
}

// Chain grouping helper
interface CardChain {
    cards: { card: CardDef; index: number; isExcess?: boolean }[];
    isComplete: boolean; // Ended with a weapon
}

const App = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [gameState, setGameState] = useState<GameState>(GameState.MENU);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [levelUpOptions, setLevelUpOptions] = useState<CardDef[]>([]);
  const [bossWarning, setBossWarning] = useState<string | null>(null);
  const [aimStatus, setAimStatus] = useState<string>("自动");
  const [selectedCardIndex, setSelectedCardIndex] = useState<number | null>(null);
  const [isGmMode, setIsGmMode] = useState(false);
  
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
      if (stats) {
         engineRef.current?.reorderInventory(stats.inventory);
      }
      setGameState(GameState.PLAYING);
      engineRef.current?.resume();
      setSelectedCardIndex(null);
  };

  // Inventory logic: Group into chains
  const getChains = (): CardChain[] => {
      if (!stats) return [];
      const chains: CardChain[] = [];
      let currentChain: { card: CardDef; index: number; isExcess?: boolean }[] = [];
      let activeEffects: { logic: string, count: number }[] = [];

      stats.inventory.forEach((card, index) => {
          // Check limits for visual "Excess" styling
          let isExcess = false;
          if (card.type === CardType.EFFECT && card.effectConfig?.logic === 'double') {
              // Count current doubles in activeEffects
              const doubleCount = activeEffects.filter(e => e.logic === 'double').length;
              // If we already have 2 "double" mods active (resulting in 4x), more are excess
              if (doubleCount >= 2) isExcess = true;
          }

          currentChain.push({ card, index, isExcess });

          // Add to effects logic tracking
          if (card.type === CardType.EFFECT && card.effectConfig && !isExcess) {
              // Apply Double Cast Multiplier logic to count
              let count = card.effectConfig.influenceCount;
              // Calc how many times this effect repeats based on PREVIOUS doubles
              let multiplier = 1;
              activeEffects.forEach(e => { if (e.logic === 'double') multiplier *= 2; });
              multiplier = Math.min(multiplier, 4);

              // Add this effect to tracking
              for(let i=0; i<multiplier; i++) {
                 activeEffects.push({ logic: card.effectConfig.logic, count: count });
              }
          }
          
          if (card.type === CardType.ARTIFACT) {
              // Artifact closes the chain
              chains.push({ cards: currentChain, isComplete: true });
              currentChain = [];
              
              // Decrement effects logic (artifacts consume 1 charge of everything)
               activeEffects.forEach(eff => {
                  eff.count--;
               });
               activeEffects = activeEffects.filter(eff => eff.count > 0);
          }
      });

      // Dangling chain (modifiers without weapon at the end)
      if (currentChain.length > 0) {
          chains.push({ cards: currentChain, isComplete: false });
      }

      return chains;
  }

  const handleSlotClick = (index: number) => {
      if (selectedCardIndex === null) {
          setSelectedCardIndex(index);
      } else {
          // Swap
          if (stats) {
              const newInv = [...stats.inventory];
              const temp = newInv[selectedCardIndex];
              newInv[selectedCardIndex] = newInv[index];
              newInv[index] = temp;
              setStats({ ...stats, inventory: newInv });
              setSelectedCardIndex(null);
          }
      }
  }

  return (
    <div className="app-container">
      <style>{`
        /* Chain Grouping Visuals */
        .chain-row {
            display: flex;
            background: rgba(0,0,0,0.5);
            border: 1px solid #444;
            padding: 8px;
            margin-bottom: 8px;
            border-radius: 8px;
            align-items: center;
            min-height: 80px;
        }
        .chain-row.incomplete {
            border-style: dashed;
            background: rgba(50,0,0,0.3);
        }
        .chain-arrow {
            color: #666;
            margin: 0 4px;
            font-size: 20px;
        }
        .inv-slot {
            width: 4rem;
            height: 4rem;
            margin-right: 8px;
            border: 2px solid #555;
            background-color: #334155;
            position: relative;
            cursor: pointer;
            transition: all 0.2s;
        }
        .inv-slot:hover {
            transform: translateY(-2px);
            border-color: white;
        }
        .inv-slot.selected {
            border-color: #facc15;
            box-shadow: 0 0 10px #facc15;
            z-index: 10;
        }
        .inv-slot.excess {
            opacity: 0.4;
            border-color: #ef4444;
        }
        .slot-badge {
            position: absolute;
            top: -5px;
            right: -5px;
            background: #22d3ee;
            color: black;
            font-size: 9px;
            padding: 1px 4px;
            border-radius: 4px;
            font-weight: bold;
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
           <h2 className="pause-title mb-4">法术链调整</h2>
           <p className="pause-desc mb-4">
             每一行代表一个独立的法术作用域。点击卡片选中，再次点击交换位置。
           </p>
           
           <div className="pause-layout items-start h-[70vh]">
               <div className="overflow-y-auto pr-2" style={{ width: '700px', maxHeight: '60vh' }}>
                 {getChains().map((chain, chainIdx) => (
                    <div key={chainIdx} className={`chain-row ${!chain.isComplete ? 'incomplete' : ''}`}>
                        {chain.cards.map((item, i) => (
                            <React.Fragment key={item.card.id + i}>
                                <div 
                                    className={`inv-slot flex flex-col items-center justify-center rarity-${item.card.rarity} ${selectedCardIndex === item.index ? 'selected' : ''} ${item.isExcess ? 'excess' : ''}`}
                                    onClick={() => handleSlotClick(item.index)}
                                >
                                    {item.card.type === CardType.EFFECT && <div className="slot-badge" style={{background: '#d946ef', color: 'white'}}>EF</div>}
                                    {item.card.type === CardType.BUFF && <div className="slot-badge">BF</div>}
                                    <span style={{ color: item.card.iconColor, fontWeight: 'bold' }}>{item.card.name.substring(0,2)}</span>
                                </div>
                                {/* Draw subtle arrow if not last */}
                                {i < chain.cards.length - 1 && <span className="chain-arrow">→</span>}
                            </React.Fragment>
                        ))}
                        {!chain.isComplete && <span className="text-gray-500 text-sm ml-4 italic">(缺少核心法器)</span>}
                    </div>
                 ))}
                 
                 {/* Placeholder for empty */}
                 {stats.inventory.length === 0 && <div className="text-gray-500 text-center mt-10">空空如也</div>}
               </div>

               {/* Details Panel */}
               <div className="details-panel">
                   {selectedCardIndex !== null && stats.inventory[selectedCardIndex] ? (
                       <>
                           <div className="details-title" style={{ color: stats.inventory[selectedCardIndex].iconColor }}>
                               {stats.inventory[selectedCardIndex].name}
                           </div>
                           <div className="details-type">{stats.inventory[selectedCardIndex].rarity} {stats.inventory[selectedCardIndex].type}</div>
                           <div className="details-desc">{stats.inventory[selectedCardIndex].description}</div>
                           <div className="mt-4 text-sm text-gray-400">
                               {stats.inventory[selectedCardIndex].type === CardType.ARTIFACT 
                                ? "法术核心：终结当前作用域，触发法术。" 
                                : "强化组件：必须放在法术核心之前生效。"}
                           </div>
                       </>
                   ) : (
                       <div className="text-gray-500 italic">点击卡片选中/交换</div>
                   )}
               </div>
           </div>

           <button 
             onClick={handleResume}
             className="btn-resume mt-4"
           >
             保存并继续
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
