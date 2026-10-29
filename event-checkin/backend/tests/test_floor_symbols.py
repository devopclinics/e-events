from types import SimpleNamespace
from xml.etree import ElementTree as ET
import pytest
from app.floor_symbols import element_svg, table_svg
from app.routers.floor import _floor_svg
from app.schemas import FloorPlanOut, FloorTableOut, FloorElementOut

@pytest.mark.parametrize('kind',['stage','dancefloor','entrance','exit','bar','label','wall','door','window','column','stairs','aisle','service','restroom','accessible','booth','tent','tree','water','power','foodtruck','parking','garden','lounge','unknown-custom-type'])
def test_indoor_and_outdoor_symbols_are_safe_valid_svg(kind):
    el=SimpleNamespace(type=kind,label='A <test> & zone',width=120,height=90,pos_x=30,pos_y=40,rotation=45,color='#cbd5e1')
    svg=element_svg(el);root=ET.fromstring('<svg>'+svg+'</svg>');assert root.find('g').get('data-object-type')==kind;assert 'A &lt;test&gt; &amp; zone' in svg;assert '<test>' not in svg

@pytest.mark.parametrize('shape',['round','rect'])
def test_table_symbols_include_chairs_and_real_occupancy(shape):
    table=SimpleNamespace(id='table-1',capacity=10,seated=4,name='Families & friends',shape=shape,pos_x=150,pos_y=200,rotation=90)
    svg=table_svg(table,'#0ea5e9');ET.fromstring('<svg>'+svg+'</svg>');assert '4/10 seats' in svg and 'Families &amp; friends' in svg;assert svg.count('fill="#f7fafb"')==10;assert 'rotate(90 42.0' in svg

def test_floor_export_uses_saved_geometry_for_all_symbols():
    plan=FloorPlanOut(event_id='e',event_name='Test',width=1200,height=800,tables=[FloorTableOut(id='t',name='A',capacity=8,seated=3,pos_x=100,pos_y=200)],elements=[FloorElementOut(id='z',event_id='e',type='tent',label='Marquee',pos_x=400,pos_y=80,width=240,height=180,rotation=45)])
    svg=_floor_svg(plan);ET.fromstring(svg);assert 'translate(400 80) rotate(45 120.0 90.0)' in svg;assert 'data-seating-id="t"' in svg;assert '3/8 seats' in svg

@pytest.mark.asyncio
async def test_floor_background_can_be_removed_without_affecting_seating(ctx):
    from conftest import _Session
    from app.models import Event, SeatingTable
    event_id=ctx.ids['event_a'];ctx.login(ctx.ids['superadmin'])
    async with _Session() as db:
        event=await db.get(Event,event_id);event.is_paid=True;event.status='active';event.seating_enabled=True
        table=SeatingTable(event_id=event_id,name='Preserved seating',capacity=10);db.add(table);await db.commit();table_id=table.id
    saved=await ctx.client.put(f'/api/events/{event_id}/floor-plan',json={'bg_image_url':'/site-assets/venue.png','tables':[{'id':table_id,'pos_x':140,'pos_y':200}],'elements':[{'type':'tent','label':'Outdoor marquee','width':240,'height':180}]})
    assert saved.status_code==200
    cleared=await ctx.client.put(f'/api/events/{event_id}/floor-plan',json={'bg_image_url':'','tables':[{'id':table_id,'pos_x':140,'pos_y':200}],'elements':saved.json()['elements']})
    assert cleared.status_code==200 and cleared.json()['bg_image_url'] is None
    table=next(t for t in cleared.json()['tables'] if t['id']==table_id)
    assert table['capacity']==10 and table['pos_x']==140
    assert cleared.json()['elements'][0]['type']=='tent'
