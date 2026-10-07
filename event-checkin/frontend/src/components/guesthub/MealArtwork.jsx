import { mealArtKinds, mealArtTone } from './meal-art.mjs';

function Food({ kind }) {
  switch (kind) {
    case 'pizza': return <><circle cx="50" cy="50" r="33" fill="#d59346"/><circle cx="50" cy="50" r="28" fill="#cf613b"/><path d="M27 38Q48 16 73 39L72 61Q52 82 28 64Z" fill="#f4cd70"/><path d="M50 22v56M25 36l49 28m-48 0 48-28" stroke="#dc9b49" strokeWidth="2"/>{[[39,36],[62,39],[50,60],[32,55],[65,59]].map(([x,y])=><circle key={x} cx={x} cy={y} r="5" fill="#bf5237"/>)}<path d="m46 29 5 3m13 18 5-2m-28 17 4 3" stroke="#548451" strokeWidth="3" strokeLinecap="round"/></>;
    case 'white-rice': case 'rice': return <><ellipse cx="50" cy="55" rx="34" ry="26" fill={kind==='white-rice'?'#c9b893':'#b96432'}/><path d="M19 52Q23 23 49 24Q77 24 82 53Q54 72 19 52" fill={kind==='white-rice'?'#f3e8ce':'#efa64d'}/>{[[30,43],[43,33],[55,40],[65,33],[73,48],[58,53],[42,50],[33,56],[49,61],[65,61]].map(([x,y])=><path key={x+':'+y} d={`m${x} ${y} 5-2m-2 6 4-1`} stroke={kind==='white-rice'?'#fffdf2':'#ffe1a0'} strokeWidth="2.4" strokeLinecap="round"/>)}<path d="m36 35 3 1m19 23 4-1m7-13 3 2" stroke="#67864d" strokeWidth="3" strokeLinecap="round"/></>;
    case 'salad': return <><ellipse cx="50" cy="56" rx="34" ry="25" fill="#457b50"/>{[[30,40,-30],[52,32,10],[70,43,40],[36,63,50],[60,63,-35],[49,48,15]].map(([x,y,r])=><ellipse key={x} cx={x} cy={y} rx="13" ry="9" transform={`rotate(${r} ${x} ${y})`} fill={x%3?'#8ebc63':'#b0cf7b'}/>)}<circle cx="34" cy="47" r="7" fill="#df7050"/><circle cx="65" cy="56" r="7" fill="#df7050"/><circle cx="50" cy="66" r="6" fill="#d7e8aa"/><path d="m45 34 12 7m-28 21 12-5" stroke="#f3e6a9" strokeWidth="3" strokeLinecap="round"/></>;
    case 'amala': case 'swallow': return <><ellipse cx="50" cy="66" rx="33" ry="14" fill="#cbb38b"/><path d="M20 61Q24 23 50 23Q79 25 82 61Q66 83 20 61" fill={kind==='amala'?'#99704c':'#ead7ad'}/><path d="M32 44q14-18 35-5M28 56q24 11 48 0" fill="none" stroke={kind==='amala'?'#b49471':'#f9edcf'} strokeWidth="5" strokeLinecap="round"/></>;
    case 'soup': case 'stew': case 'beans': return <><circle cx="50" cy="51" r="33" fill="#b87946"/><circle cx="50" cy="48" r="28" fill={kind==='soup'?'#647e41':kind==='beans'?'#a6583c':'#bb5136'}/>{[[34,35],[52,30],[65,41],[37,56],[56,51],[64,65],[48,68],[25,46]].map(([x,y],i)=><ellipse key={x+':'+y} cx={x} cy={y} rx={kind==='beans'?5:4} ry="3" transform={`rotate(${i*30} ${x} ${y})`} fill={kind==='soup'?'#a7b66d':kind==='beans'?'#e4ae74':'#e59c52'}/>)}<path d="M31 45q11-17 29-12" stroke="#ffffff40" strokeWidth="3" fill="none" strokeLinecap="round"/></>;
    case 'fish': return <><path d="m71 42 15-10-1 33-16-10" fill="#bb794e"/><path d="M17 51Q41 18 74 45L73 58Q40 80 17 51" fill="#d3a16b"/><path d="M35 36q11 15 0 31m12-35q12 19 0 35m12-33q10 14 0 29" stroke="#a46b44" strokeWidth="3" fill="none"/><circle cx="27" cy="48" r="2.5" fill="#334c43"/><path d="m41 30 12-7 10 11M40 70l14 6 8-9" fill="#b68050"/></>;
    case 'chicken': return <><path d="m39 57-12 16-7-1-3 6 5 5 6-2 1-6 14-12" fill="#f1dfb6"/><path d="M37 64C18 51 36 26 54 24c25-3 31 27 11 39-10 6-18 7-28 1" fill="#bb6837"/><path d="M39 39q12-14 24-6" fill="none" stroke="#e59b53" strokeWidth="7" strokeLinecap="round"/><path d="m47 47 3-3m7 9 4-4m-16 9 4-3" stroke="#854829" strokeWidth="3" strokeLinecap="round"/></>;
    case 'meat': return <><path d="M24 39 46 27l20 12-6 23-29 6-12-13Z" fill="#a45b3e"/><path d="m48 53 23-9 13 19-15 14-24-6Z" fill="#bc7950"/><path d="m28 42 28-5m-29 15 26-5m0 14 22-5" stroke="#e0aa71" strokeWidth="4" strokeLinecap="round"/></>;
    case 'pasta': return <><ellipse cx="50" cy="53" rx="34" ry="28" fill="#e1a94e"/><path d="M25 44q25-27 46 2T31 64q-18-23 28-26t5 25q-37 18-29-17t29-3q17 28-27 18m-7-26q22 6 9 37" stroke="#f9d886" strokeWidth="4" fill="none" strokeLinecap="round"/><path d="M43 29q19-7 26 10l-8 9-16-4Z" fill="#bf593b"/></>;
    case 'plantain': return <>{[[30,40,-30],[53,32,15],[66,52,-15],[42,64,20]].map(([x,y,r])=><g key={x} transform={`rotate(${r} ${x} ${y})`}><ellipse cx={x} cy={y} rx="10" ry="17" fill="#be7b31"/><ellipse cx={x} cy={y-1} rx="7" ry="13" fill="#eabc58"/><path d={`M${x} ${y-7}v12`} stroke="#a56d34" strokeWidth="2"/></g>)}</>;
    case 'yam': return <><ellipse cx="50" cy="54" rx="34" ry="26" fill="#be7140"/>{[[27,42],[46,32],[65,44],[37,59],[59,62]].map(([x,y],i)=><rect key={x} x={x} y={y} width="17" height="15" rx="4" transform={`rotate(${i*11-10} ${x} ${y})`} fill="#e7b56e"/>)}</>;
    case 'bread': return <><path d="M18 59C16 29 75 15 84 46c11 24-57 42-66 13" fill="#c28a48"/><path d="M20 50C31 25 69 24 79 44c3 18-49 34-59 6" fill="#e4b976"/><path d="m36 33 5 18m10-22 5 17m10-19 5 16" stroke="#f9dfac" strokeWidth="5" strokeLinecap="round"/></>;
    case 'fries': return <>{[0,1,2,3,4,5].map(i=><rect key={i} x={24+i*8} y={24+(i%3)*5} width="7" height="47" rx="2" transform={`rotate(${i%2?12:-9} 50 50)`} fill={i%2?'#efc260':'#dda146'}/>)}<path d="M24 53h53l-5 25H30Z" fill="#be6951"/><path d="M38 61h23" stroke="#f2c69b" strokeWidth="3" strokeLinecap="round"/></>;
    case 'drink': return <><path d="M31 25h39l-5 54H36Z" fill="#d5e6dd"/><path d="M34 42h33l-4 34H38Z" fill="#e8b758"/><path d="m51 68 7-53 14-5" stroke="#477a68" strokeWidth="4" fill="none" strokeLinecap="round"/><path d="m40 33 4 35" stroke="#ffffffa0" strokeWidth="4" strokeLinecap="round"/><ellipse cx="50" cy="27" rx="19" ry="4" fill="none" stroke="#a1bcac" strokeWidth="2"/></>;
    case 'breakfast': return <><path d="M27 33c20-16 54 0 52 26S30 84 22 63s-4-16 5-30" fill="#fbf7e8" stroke="#e7dab8" strokeWidth="2"/><circle cx="50" cy="51" r="15" fill="#e8b64c"/><path d="M43 44q7-5 13 0" fill="none" stroke="#f9db7f" strokeWidth="4" strokeLinecap="round"/></>;
    case 'fruit': return <><path d="M26 37q12-10 24 0 25-13 28 12-1 29-25 31-25-1-29-25Z" fill="#cf7152"/><path d="M50 34q-1-11 8-16" stroke="#6d8052" strokeWidth="4" fill="none"/><path d="M56 25q5-15 19-10-2 15-19 10" fill="#88a565"/><path d="M33 44q-6 11 0 17" stroke="#e9aa86" strokeWidth="4" fill="none" strokeLinecap="round"/></>;
    default: return <><path d="M21 63a29 29 0 0 1 58 0Z" fill="#9cbaa7"/><path d="M28 56a22 22 0 0 1 22-19" stroke="#dce8dc" strokeWidth="4" fill="none" strokeLinecap="round"/><circle cx="50" cy="30" r="5" fill="#c9a460"/><path d="M18 67h64" stroke="#577e68" strokeWidth="5" strokeLinecap="round"/></>;
  }
}

export default function MealArtwork({ option = {}, small = false }) {
  const kinds = mealArtKinds(option);
  const tone = mealArtTone(option.id || option.name);
  const count = kinds.length;
  const positions = count === 1 ? [[98, 24, 1.25]] : count === 2 ? [[61, 21, 1.13], [172, 51, .91]] : count === 3 ? [[34, 47, .97], [118, 12, 1.12], [215, 62, .78]] : [[31, 26, .94], [119, 54, 1], [207, 20, .86], [259, 103, .48]];
  return <div className={`vm-art vm-artwork vm-artwork-${tone} ${small ? 'vm-art-small' : ''}`} data-food-art={kinds.join(' ')} aria-hidden="true"><svg viewBox="0 0 340 180" preserveAspectRatio="xMidYMid meet">
    <circle cx="36" cy="32" r="52" fill="#ffffff30"/><circle cx="306" cy="153" r="67" fill="#ffffff25"/>
    <path d="m12 142 57-96 31 19-57 96Z" fill="#ffffff26"/>
    <path d="M276 33h27m-22 8h27M17 102h18" stroke="#ffffff75" strokeWidth="2" strokeLinecap="round"/>
    <g className="vm-food-scene">{kinds.map((kind, i) => { const [x,y,scale] = positions[i]; return <g key={kind} transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx="52" cy="57" rx="46" ry="42" fill="#304d3420"/><circle cx="50" cy="50" r="44" fill="#fffdf5"/><circle cx="50" cy="50" r="37" fill="#f0ecde"/><circle cx="50" cy="50" r="36" fill="none" stroke="#ded9c5" strokeWidth=".7"/><Food kind={kind}/>
    </g>; })}</g>
    <g className="vm-art-steam" fill="none" stroke="#ffffffb0" strokeWidth="2" strokeLinecap="round"><path d="M145 21q-5-5 0-10m12 13q-5-5 0-10m12 7q-5-5 0-10"/></g>
    <path d="M24 157q7-11 16-9-2 12-16 9m8-5 9-2M308 68q-11-7-9-16 12 2 9 16m-5-8-2-9" fill="#758e6260"/>
  </svg></div>;
}
