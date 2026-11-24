"""Two event-local roles with explicit operational permissions; legacy grants retain their scope."""
from typing import Literal
from pydantic import BaseModel,Field
Permission=Literal['checkin','children','support','outings','inventory','messages','volunteers','reconcile']
Role=Literal['admin','volunteer','scanner','intake','support','inventory','supervisor']
CATALOG={'checkin':'Check-in, pickup & movements','children':'Add/correct children & guardians','support':'Support desks & restricted notes','outings':'Create & manage outings','inventory':'Manage inventory','messages':'Guardian contacts & notification history','volunteers':'Coordinate volunteers & shifts','reconcile':'Resolve previous-day movement records'}
ALL=set(CATALOG)
LEGACY={'scanner':{'checkin'},'intake':{'checkin','children','messages'},'support':{'checkin','support'},'inventory':{'inventory'},'supervisor':set(ALL)}
class Grant(BaseModel):
    role:Literal['admin','volunteer']='volunteer'
    permissions:list[Permission]=Field(default_factory=lambda:['checkin'],max_length=8)
class Principal(str):
    def __new__(cls,value,permissions,admin=False):
        obj=super().__new__(cls,value);obj.permissions=set(permissions);obj.admin=admin;return obj

def principal(value,owner=False):
    if owner:return Principal('supervisor',ALL,True)
    if isinstance(value,str) and value in LEGACY:return Principal(value,LEGACY[value])
    if isinstance(value,str) and value in ('admin','volunteer'):value={'role':value,'permissions':['checkin']}
    if isinstance(value,dict) and value.get('role') in ('admin','volunteer'):
        admin=value['role']=='admin';permissions=value.get('permissions',[])
        if not isinstance(permissions,list):return None
        return Principal('supervisor' if admin else 'scanner',ALL if admin else {v for v in permissions if isinstance(v,str)}&ALL,admin)
    return None

def can(role,permission):
    p=role if isinstance(role,Principal) else principal(role)
    if not p:return False
    if permission=='view_children':return bool(p.permissions & {'checkin','children','support','outings','messages','reconcile'})
    if permission=='reconcile':return 'reconcile' in p.permissions
    return permission in p.permissions

def entry(role,permissions=None):
    if role in LEGACY and permissions is None:return role
    if role not in ('admin','volunteer'):raise ValueError('Choose Admin or Volunteer when assigning permissions')
    return {'role':role,'permissions':sorted(ALL if role=='admin' else set(['checkin'] if permissions is None else permissions)&ALL)}

def signature(value,owner=False):
    p=principal(value,owner)
    return (bool(p and p.admin),tuple(sorted(p.permissions)) if p else ())

def info(value,owner=False):
    p=principal(value,owner)
    return {'role':'admin' if p and p.admin else 'volunteer','permissions':sorted(p.permissions) if p else []}
