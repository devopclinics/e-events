export function seatingPlan({mode, guests, tables, seatsPerTable, existingTables=[]}) {
 const existingSeats=existingTables.reduce((sum,t)=>sum+Math.max(0,Number(t.capacity)||0),0)
 const seats=Number(seatsPerTable), target=guests===''||guests==null?null:Number(guests)
 const result={existingSeats,existingCount:existingTables.length,targetGuests:target,tableCount:0,newSeats:0,totalSeats:existingSeats,spare:0,shortfall:0,error:''}
 if(!Number.isInteger(seats)||seats<1||seats>100)return {...result,error:'Choose between 1 and 100 seats per table.'}
 if(mode==='guests'&&(!Number.isInteger(target)||target<1))return {...result,error:'Enter the total number of guests to plan for.'}
 if(target!==null&&(!Number.isInteger(target)||target<1))return {...result,error:'Guest count must be a whole number greater than zero.'}
 const count=mode==='single'?1:mode==='guests'?Math.ceil(Math.max(0,target-existingSeats)/seats):Number(tables)
 if(!Number.isInteger(count)||count<0||mode==='tables'&&count<1)return {...result,error:'Enter a whole number of tables to add.'}
 if(count>200)return {...result,error:'You can add up to 200 tables in one batch. Increase seats per table or create separate groups.'}
 const newSeats=count*seats,totalSeats=existingSeats+newSeats
 return {...result,tableCount:count,newSeats,totalSeats,spare:target===null?0:Math.max(0,totalSeats-target),shortfall:target===null?0:Math.max(0,target-totalSeats)}
}
export function plannedTableNames(group,count){return Array.from({length:count},(_,i)=>`${group.trim()} ${i+1}`)}
export function hasPlannedTables(existingTables,group,count){const wanted=new Set(plannedTableNames(group,count).map(n=>n.toLowerCase()));return existingTables.some(t=>wanted.has(String(t.name).trim().toLowerCase()))}
