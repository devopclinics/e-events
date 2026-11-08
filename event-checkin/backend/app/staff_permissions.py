"""An explicit feature allowlist narrows existing event roles; null preserves legacy access.

This is an additional authorization boundary, never a replacement for tenant,
paid-feature, scanner-section or Guest Services checks.
"""
from fastapi import Depends, HTTPException, Request
from fastapi.routing import APIRoute
from fastapi.dependencies.utils import get_dependant
from sqlalchemy import select
from .auth import get_current_user, _org_role
from .database import get_db
from .models import Event, EventUser, User, Guest

FEATURES = frozenset(('overview', 'guests', 'export', 'scanner', 'seating', 'menu',
    'planner', 'conference', 'live', 'access', 'logistics', 'registry', 'speakers',
    'partners', 'reminders', 'festiome', 'guestservices', 'team', 'tasks',
    'experience', 'messages', 'settings', 'design', 'website', 'donations', 'ticketing'))
MODULES = {'dashboard':'overview','guests':'guests','scanner':'scanner','classify':'scanner',
    'seating':'seating','floor':'seating','menu':'menu','conference_center':'conference',
    'live_content':'conference','engagement':'live','access':'access','logistics':'logistics',
    'registry':'registry','speakers':'speakers','partners':'partners','reminders':'reminders',
    'scheduled_communications':'messages','festiome':'festiome','guest_services':'guestservices',
    'tasks':'tasks','experience':'experience','messaging':'messages','templates':'design',
    'design_proxy':'design','public_sites':'website','donations':'donations'}

def validate_policy(value):
    if not isinstance(value, dict) or any(k not in FEATURES or v not in ('view','manage') for k,v in value.items()):
        raise HTTPException(422, 'Feature access must use known features and view or manage levels; omit denied features')
    return dict(value)

def route_feature(route, path):
    module = route.endpoint.__module__.rsplit('.',1)[-1]
    if module == 'certificate_workflow': return 'conference'
    if module == 'group_passes': return 'scanner' if path.startswith('/api/scan/') else 'guests'
    if '/members' in path or '/team' in path: return 'team'
    if '/guests/export' in path: return 'export'
    if module == 'auth':
        return 'ticketing' if 'ticketing-token' in path else 'planner' if 'planner-token' in path else 'live' if 'live-token' in path else 'festiome' if 'festiome-token' in path else None
    if module == 'guests' and any(x in path for x in ('send','invite','remind','broadcast')): return 'messages'
    if module == 'events':
        if any(x in path for x in ('ticket-type', 'ticketing')): return 'ticketing'
        if any(x in path for x in ('broadcast', 'send-invites', 'messaging', 'post-event-thankyou')): return 'messages'
        if any(x in path for x in ('rsvp-question','invite-settings','rsvp-link','upload-cover','upload-logo')): return 'design'
        return 'settings'
    return MODULES.get(module, 'settings')

async def enforce_staff_features(request: Request, user: User = Depends(get_current_user), db=Depends(get_db)):
    if user.is_platform_superadmin: return
    event_id = request.path_params.get('event_id') or request.query_params.get('event_id')
    if not event_id and request.path_params.get('qr_token'):
        guest = await db.scalar(select(Guest).where(Guest.qr_token == request.path_params['qr_token']))
        if not guest: raise HTTPException(404, 'Pass not found')
        event_id = guest.event_id
    if not event_id: return  # organization routes retain their own guards
    event = await db.get(Event, event_id)
    if not event: raise HTTPException(404, 'Event not found')
    role = await _org_role(user, event.org_id, db)
    if role in ('owner','admin'): return
    if role is None: raise HTTPException(404, 'Event not found')
    eu = await db.scalar(select(EventUser).where(EventUser.event_id==event_id, EventUser.user_id==user.id))
    if not eu: raise HTTPException(403, 'You are not assigned to this event')
    write = request.method not in ('GET','HEAD','OPTIONS')
    route = request.scope['route']
    path = route.path
    # Metadata is necessary for selecting an assigned event, not editing it.
    if path in ('/api/events/{event_id}', '/{event_id}') and not write: return
    if eu.event_role == 'manager' and (eu.access_level or 'edit') == 'view' and write:
        # Token exchange is a read operation even though transported by POST.
        if not path.endswith(('/planner-token','/live-token','/festiome-token','/ticketing-token')):
            raise HTTPException(403, 'This event access is view-only.')
    if eu.feature_permissions is None: return
    feature = route_feature(route, path)
    if feature is None: return
    level = eu.feature_permissions.get(feature)
    if level not in ('view','manage') or (write and level != 'manage' and not path.endswith(('/planner-token','/live-token','/festiome-token','/ticketing-token'))):
        raise HTTPException(403, f'You do not have {"manage" if write else "view"} access to {feature} for this event')

def install_staff_feature_guards(app):
    """Attach only to authenticated event routes; public RSVP remains public."""
    def authenticated(dep):
        return dep.call is get_current_user or any(authenticated(d) for d in dep.dependencies)
    def visit(routes):
        for route in routes:
            if hasattr(route, 'original_router'):
                visit(route.original_router.routes)
                continue
            if not isinstance(route, APIRoute) or not authenticated(route.dependant): continue
            if '{event_id}' not in route.path and '{qr_token}' not in route.path and not route.path.endswith(('/planner-token','/live-token','/festiome-token','/ticketing-token')): continue
            if any(d.call is enforce_staff_features for d in route.dependant.dependencies): continue
            route.dependencies.insert(0, Depends(enforce_staff_features))
            route.dependant.dependencies.insert(0, get_dependant(path=route.path_format, call=enforce_staff_features))
    visit(app.routes)

async def delegated_feature_access(event_id, request, user, db):
    """Allow an explicitly delegated tool, never general settings or team authority."""
    eu = await db.scalar(select(EventUser).where(EventUser.event_id==event_id, EventUser.user_id==user.id))
    if not eu or eu.guest_service_scoped or eu.feature_permissions is None: return False
    feature = route_feature(request.scope['route'], request.scope['route'].path)
    if feature in ('team','settings') or feature is None: return False
    level = eu.feature_permissions.get(feature)
    if eu.event_role == 'manager' and eu.access_level == 'view' and request.method not in ('GET','HEAD','OPTIONS'): return False
    return level == 'manage' or (level == 'view' and request.method in ('GET','HEAD','OPTIONS'))
