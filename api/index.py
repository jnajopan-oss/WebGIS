import sys
import os
import json

# Add parent directory to sys.path so we can import server.py configurations
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import get_db_connection

def send_json(start_response, data, status=200):
    status_map = {
        200: "200 OK",
        400: "400 Bad Request",
        404: "404 Not Found",
        500: "500 Internal Server Error"
    }
    status_str = status_map.get(status, f"{status} Error")
    
    headers = [
        ('Content-Type', 'application/json'),
        ('Access-Control-Allow-Origin', '*'),
        ('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'),
        ('Access-Control-Allow-Headers', 'Content-Type')
    ]
    start_response(status_str, headers)
    return [json.dumps(data).encode('utf-8')]

def handler(environ, start_response):
    path = environ.get('PATH_INFO', '')
    method = environ.get('REQUEST_METHOD', 'GET')
    
    # Handle CORS OPTIONS request
    if method == 'OPTIONS':
        start_response('200 OK', [
            ('Access-Control-Allow-Origin', '*'),
            ('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'),
            ('Access-Control-Allow-Headers', 'Content-Type')
        ])
        return [b'']
        
    # Read POST payload if applicable
    payload = {}
    if method == 'POST':
        try:
            content_length = int(environ.get('CONTENT_LENGTH', 0))
            post_data = environ['wsgi.input'].read(content_length)
            if post_data:
                payload = json.loads(post_data.decode('utf-8'))
        except Exception as e:
            print(f"Error parsing POST payload: {e}")
            pass

    # Routing
    try:
        # GET Routes
        if method == 'GET':
            if path == '/api/data':
                return handle_get_data(start_response)
            elif path == '/api/admin/surveyors':
                return handle_get_surveyors(start_response)
            elif path == '/api/admin/licenses':
                return handle_get_licenses(start_response)
            elif path == '/api/admin/leads':
                return handle_get_leads(start_response)
            elif path == '/api/admin/logs':
                return send_json(start_response, {"logs": []})
            else:
                return send_json(start_response, {"success": False, "message": f"Endpoint GET {path} not found"}, 404)
        
        # POST Routes
        elif method == 'POST':
            if path == '/api/auth/login':
                return handle_login(start_response, payload)
            elif path == '/api/auth/register':
                return handle_register(start_response, payload)
            elif path == '/api/auth/logout':
                return handle_logout(start_response, payload)
            elif path == '/api/data/sync':
                return handle_sync_data(start_response, payload)
            elif path == '/api/admin/license/create':
                return handle_create_license(start_response, payload)
            elif path == '/api/admin/license/delete':
                return handle_delete_license(start_response, payload)
            elif path == '/api/admin/sql':
                return handle_execute_sql(start_response, payload)
            else:
                return send_json(start_response, {"success": False, "message": f"Endpoint POST {path} not found"}, 404)
                
        else:
            return send_json(start_response, {"success": False, "message": f"Method {method} not supported"}, 400)
            
    except Exception as e:
        print(f"Serverless function crash: {e}")
        return send_json(start_response, {"success": False, "message": str(e)}, 500)

# ==================== HANDLER IMPLEMENTATIONS ====================

def handle_get_data(start_response):
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        # Get points
        cursor.execute("SELECT * FROM survey_points")
        db_points = cursor.fetchall()
        points = []
        for p in db_points:
            try:
                props = json.loads(p['properties'])
            except:
                props = {}
            props['name'] = p['name']
            props['elevation'] = p['elevation']
            props['solution'] = p['solution']
            props['time'] = p['time']
            props['surveyor'] = p['surveyor']
            
            points.append({
                "type": "Feature",
                "id": p['id'],
                "geometry": {
                    "type": "Point",
                    "coordinates": [p['longitude'], p['latitude']]
                },
                "properties": props
            })

        # Get lines
        cursor.execute("SELECT * FROM digitized_lines")
        db_lines = cursor.fetchall()
        lines = []
        for l in db_lines:
            try:
                props = json.loads(l['properties'])
                geom = json.loads(l['geometry'])
            except:
                props = {}
                geom = {"type": "LineString", "coordinates": []}
            lines.append({
                "type": "Feature",
                "id": l['id'],
                "geometry": geom,
                "properties": props
            })

        # Get polygons
        cursor.execute("SELECT * FROM digitized_polygons")
        db_polys = cursor.fetchall()
        polys = []
        for poly in db_polys:
            try:
                props = json.loads(poly['properties'])
                geom = json.loads(poly['geometry'])
            except:
                props = {}
                geom = {"type": "Polygon", "coordinates": []}
            polys.append({
                "type": "Feature",
                "id": poly['id'],
                "geometry": geom,
                "properties": props
            })

        data = {
            "survey_points": points,
            "digitized_lines": lines,
            "digitized_polygons": polys,
            "stats": {
                "points": len(points),
                "lines": len(lines),
                "polygons": len(polys)
            }
        }
        
        cursor.close()
        conn.close()
        return send_json(start_response, data)
    except Exception as e:
        return send_json(start_response, {"success": False, "message": str(e)}, 500)

def handle_get_surveyors(start_response):
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT name, email, license, device, status FROM users")
        users = cursor.fetchall()
        cursor.close()
        conn.close()
        return send_json(start_response, users)
    except Exception as e:
        return send_json(start_response, {"success": False, "message": str(e)}, 500)

def handle_get_licenses(start_response):
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT * FROM licenses")
        lics = cursor.fetchall()
        cursor.close()
        conn.close()
        return send_json(start_response, lics)
    except Exception as e:
        return send_json(start_response, {"success": False, "message": str(e)}, 500)

def handle_get_leads(start_response):
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT * FROM leads")
        leads = cursor.fetchall()
        cursor.close()
        conn.close()
        return send_json(start_response, leads)
    except Exception as e:
        return send_json(start_response, {"success": False, "message": str(e)}, 500)

def handle_login(start_response, payload):
    email = payload.get('email', '').strip()
    password = payload.get('password', '')
    device = payload.get('device', 'PC/Desktop')

    if not email or not password:
        return send_json(start_response, {"success": False, "message": "Email dan password wajib diisi"}, 400)

    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT * FROM users WHERE LOWER(email) = LOWER(%s)", (email,))
        user = cursor.fetchone()

        if not user:
            cursor.close()
            conn.close()
            return send_json(start_response, {"success": False, "message": "Email tidak terdaftar!"}, 400)

        if user['password'] != password:
            cursor.close()
            conn.close()
            return send_json(start_response, {"success": False, "message": "Password salah!"}, 400)

        # Update device and status to Online
        cursor.execute(
            "UPDATE users SET status = 'Online', device = %s WHERE email = %s",
            (device, user['email'])
        )
        conn.commit()
        
        # Remove password field from response
        del user['password']
        user['device'] = device
        user['status'] = 'Online'

        cursor.close()
        conn.close()
        return send_json(start_response, {"success": True, "user": user})
    except Exception as e:
        return send_json(start_response, {"success": False, "message": str(e)}, 500)

def handle_register(start_response, payload):
    email = payload.get('email', '').strip()
    name = payload.get('name', '').strip()
    password = payload.get('password', '')

    if not email or not name or not password:
        return send_json(start_response, {"success": False, "message": "Semua kolom wajib diisi"}, 400)

    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        
        # Check exist
        cursor.execute("SELECT email FROM users WHERE LOWER(email) = LOWER(%s)", (email,))
        if cursor.fetchone():
            cursor.close()
            conn.close()
            return send_json(start_response, {"success": False, "message": "Email sudah terdaftar!"}, 400)

        # Insert new user with default license
        cursor.execute(
            "INSERT INTO users (email, name, role, license, device, status, password) "
            "VALUES (%s, %s, 'user', 'NusaGIS-2026', 'PC/Mobile Device', 'Online', %s)",
            (email, name, password)
        )
        conn.commit()
        
        cursor.close()
        conn.close()
        return send_json(start_response, {"success": True, "message": "Daftar Akun Berhasil!"})
    except Exception as e:
        return send_json(start_response, {"success": False, "message": str(e)}, 500)

def handle_logout(start_response, payload):
    email = payload.get('email', '').strip()
    if not email:
        return send_json(start_response, {"success": False, "message": "Email required"}, 400)
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE users SET status = 'Offline' WHERE email = %s", (email,))
        conn.commit()
        cursor.close()
        conn.close()
        return send_json(start_response, {"success": True, "message": "Logged out successfully"})
    except Exception as e:
        return send_json(start_response, {"success": False, "message": str(e)}, 500)

def handle_sync_data(start_response, payload):
    points = payload.get('survey_points', [])
    lines = payload.get('digitized_lines', [])
    polys = payload.get('digitized_polygons', [])

    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Truncate tables for a clean sync replacement
        cursor.execute("DELETE FROM survey_points")
        cursor.execute("DELETE FROM digitized_lines")
        cursor.execute("DELETE FROM digitized_polygons")

        # Insert points
        for p in points:
            coords = p['geometry']['coordinates']
            props = p['properties']
            props_str = json.dumps(props)
            cursor.execute(
                "INSERT INTO survey_points (id, name, latitude, longitude, elevation, solution, properties, time, surveyor) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (p['id'], props.get('name', 'Point'), coords[1], coords[0], props.get('elevation', 0), props.get('solution', 'Fix'), props_str, props.get('time', ''), props.get('surveyor', 'Guest'))
            )

        # Insert lines
        for l in lines:
            props_str = json.dumps(l['properties'])
            geom_str = json.dumps(l['geometry'])
            cursor.execute(
                "INSERT INTO digitized_lines (id, name, geometry, properties) VALUES (%s, %s, %s, %s)",
                (l['id'], l['properties'].get('name', 'Line'), geom_str, props_str)
            )

        # Insert polygons
        for poly in polys:
            props_str = json.dumps(poly['properties'])
            geom_str = json.dumps(poly['geometry'])
            cursor.execute(
                "INSERT INTO digitized_polygons (id, name, geometry, properties) VALUES (%s, %s, %s, %s)",
                (poly['id'], poly['properties'].get('name', 'Polygon'), geom_str, props_str)
            )

        conn.commit()
        cursor.close()
        conn.close()
        return send_json(start_response, {"success": True, "message": "Synchronized successfully"})
    except Exception as e:
        return send_json(start_response, {"success": False, "message": str(e)}, 500)

def handle_create_license(start_response, payload):
    code = payload.get('code', '').strip()
    client = payload.get('client', '').strip()
    quota = int(payload.get('quota', 10))

    if not code or not client:
        return send_json(start_response, {"success": False, "message": "Missing key details"}, 400)

    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO licenses (code, client, quota, used, status) VALUES (%s, %s, %s, 0, 'Active')",
            (code, client, quota)
        )
        conn.commit()
        cursor.close()
        conn.close()
        return send_json(start_response, {"success": True, "message": "License generated!"})
    except Exception as e:
        return send_json(start_response, {"success": False, "message": str(e)}, 500)

def handle_delete_license(start_response, payload):
    code = payload.get('code', '').strip()
    if not code:
        return send_json(start_response, {"success": False, "message": "Code required"}, 400)

    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM licenses WHERE code = %s", (code,))
        conn.commit()
        cursor.close()
        conn.close()
        return send_json(start_response, {"success": True, "message": "License deleted"})
    except Exception as e:
        return send_json(start_response, {"success": False, "message": str(e)}, 500)

def handle_execute_sql(start_response, payload):
    query = payload.get('query', '').strip()
    if not query:
        return send_json(start_response, {"success": False, "message": "Kueri SQL kosong!"}, 400)

    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute(query)
        
        if query.upper().startswith('SELECT') or query.upper().startswith('SHOW') or query.upper().startswith('DESCRIBE'):
            rows = cursor.fetchall()
            columns = [desc[0] for desc in cursor.description] if cursor.description else []
            cursor.close()
            conn.close()
            return send_json(start_response, {"success": True, "columns": columns, "rows": rows})
        else:
            conn.commit()
            affected = cursor.rowcount
            cursor.close()
            conn.close()
            return send_json(start_response, {
                "success": True, 
                "columns": ["message", "rows_affected"], 
                "rows": [{"message": "Kueri SQL berhasil dieksekusi", "rows_affected": affected}]
            })
    except Exception as e:
        return send_json(start_response, {"success": False, "message": str(e)}, 400)
