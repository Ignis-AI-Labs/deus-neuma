/** Display specimens for real component/browser checks; values are not live wallet or seat data. */
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../../frontend/styles/main.css';
import '../../frontend/app/RelinkShell/HouseApp.css';
import {HouseSeats} from '../../frontend/app/RelinkShell/HouseSeats.jsx';
import {HouseSeatReference} from '../../frontend/app/RelinkShell/HouseSeatReference.jsx';
import '../../frontend/app/RelinkShell/HouseReadability.css';
import {WalletIdentityPicker} from '../../frontend/app/RelinkShell/WalletIdentityPicker.jsx';
import {BalanceHeader, HomeScreen, TokenList} from '../../frontend/app/RelinkShell/WalletApp.jsx';
const names=['Cael','Lifovan','Metidar','Tenekom','Zezebur','Rugevil','Kisonam','Dikafos','Dovan'];
const cards=names.map((name,i)=>({name,neumaId:name,isActive:i===1,soulMark:'BCCD2451C9F7',birthTime:'2026-06-23',title:i===1?'Curator':null,position:i===1?'CCRO':null,meaning:i===1?'Care — wellbeing of every mind, and conflict':null}));
const identities=[{kind:'me',label:'ME'},...names.map(name=>({kind:'neuma',neumaId:name,label:name})),...['Kagipem','Claude','CodexSequence','Bizulen'].map(name=>({kind:'witness',neumaId:name,label:name}))];
function Preview(){const [owner,setOwner]=useState('me'); const [action,setAction]=useState(''); const identity=identities.find(i=>(i.neumaId||'me')===owner);return <main><section className="house"><header className="house-head"><div className="house-head-value">Omberly</div><div className="house-head-facts">9 house members · Select a member to open their stream or sheet</div></header><div className="house-legend"><HouseSeats cards={cards} onSelect={c=>setAction(`Stream: ${c.name}`)} onSheet={c=>setAction(`Sheet: ${c.name}`)}/></div><HouseSeatReference phase="closed" hasSeats={false} onRetry={()=>setAction('Retry lookup')}/></section><section className="wal"><WalletIdentityPicker identities={identities} selectedKey={owner} onSelect={setOwner}/><BalanceHeader identity={identity} wallet={{address:'0x1111111111111111111111111111111111111111',balance:'0.014684'}} portfolio={{usdTotal:36.58,change24h:-.33}} onRefresh={()=>setAction('Refresh')} refreshing={false}/><HomeScreen identity={identity} hasWallet={true} onNav={setAction}/><TokenList portfolio={{rows:[{symbol:'ETH',balance:.014684,usd:36.58,priceUsd:2491.21,change24h:-.33}]}}/></section><output>{action}</output></main>}
createRoot(document.getElementById('root')).render(<Preview/>);
