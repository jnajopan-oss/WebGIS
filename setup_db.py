import mysql.connector
from mysql.connector import errorcode

# Database configuration
config = {
    'user': 'root',
    'password': '',
    'host': 'localhost'
}

DB_NAME = 'webgis'

TABLES = {}

TABLES['users'] = (
    "CREATE TABLE `users` ("
    "  `email` varchar(100) NOT NULL,"
    "  `name` varchar(100) NOT NULL,"
    "  `role` varchar(20) NOT NULL,"
    "  `license` varchar(100) NOT NULL,"
    "  `device` varchar(100) DEFAULT NULL,"
    "  `status` varchar(20) NOT NULL,"
    "  `password` varchar(100) NOT NULL,"
    "  PRIMARY KEY (`email`)"
    ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;"
)

TABLES['survey_points'] = (
    "CREATE TABLE `survey_points` ("
    "  `id` varchar(50) NOT NULL,"
    "  `name` varchar(100) NOT NULL,"
    "  `latitude` double NOT NULL,"
    "  `longitude` double NOT NULL,"
    "  `elevation` double NOT NULL,"
    "  `solution` varchar(20) NOT NULL,"
    "  `properties` text NOT NULL,"
    "  `time` varchar(50) NOT NULL,"
    "  `surveyor` varchar(100) NOT NULL,"
    "  PRIMARY KEY (`id`)"
    ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;"
)

TABLES['digitized_lines'] = (
    "CREATE TABLE `digitized_lines` ("
    "  `id` varchar(50) NOT NULL,"
    "  `name` varchar(100) NOT NULL,"
    "  `geometry` text NOT NULL,"
    "  `properties` text NOT NULL,"
    "  PRIMARY KEY (`id`)"
    ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;"
)

TABLES['digitized_polygons'] = (
    "CREATE TABLE `digitized_polygons` ("
    "  `id` varchar(50) NOT NULL,"
    "  `name` varchar(100) NOT NULL,"
    "  `geometry` text NOT NULL,"
    "  `properties` text NOT NULL,"
    "  PRIMARY KEY (`id`)"
    ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;"
)

TABLES['licenses'] = (
    "CREATE TABLE `licenses` ("
    "  `code` varchar(100) NOT NULL,"
    "  `client` varchar(100) NOT NULL,"
    "  `quota` int(11) NOT NULL,"
    "  `used` int(11) NOT NULL,"
    "  `status` varchar(20) NOT NULL,"
    "  PRIMARY KEY (`code`)"
    ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;"
)

TABLES['leads'] = (
    "CREATE TABLE `leads` ("
    "  `id` int(11) NOT NULL AUTO_INCREMENT,"
    "  `name` varchar(100) NOT NULL,"
    "  `interest` varchar(100) NOT NULL,"
    "  `contact` varchar(100) NOT NULL,"
    "  `date` varchar(50) NOT NULL,"
    "  PRIMARY KEY (`id`)"
    ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;"
)

def create_database(cursor):
    try:
        cursor.execute(
            f"CREATE DATABASE {DB_NAME} DEFAULT CHARACTER SET 'utf8mb4'")
        print(f"Database {DB_NAME} created successfully.")
    except mysql.connector.Error as err:
        print(f"Failed creating database: {err}")
        exit(1)

def main():
    try:
        conn = mysql.connector.connect(**config)
        cursor = conn.cursor()
    except mysql.connector.Error as err:
        print(f"Connection failed: {err}")
        exit(1)

    try:
        cursor.execute(f"USE {DB_NAME}")
    except mysql.connector.Error as err:
        if err.errno == errorcode.ER_BAD_DB_ERROR:
            create_database(cursor)
            conn.database = DB_NAME
        else:
            print(err)
            exit(1)

    # Create Tables
    for table_name in TABLES:
        table_description = TABLES[table_name]
        try:
            print(f"Creating table {table_name}: ", end='')
            # Drop table if exists for clean seeding
            cursor.execute(f"DROP TABLE IF EXISTS `{table_name}`")
            cursor.execute(table_description)
            print("OK")
        except mysql.connector.Error as err:
            if err.errno == errorcode.ER_TABLE_EXISTS_ERROR:
                print("already exists.")
            else:
                print(err.msg)

    # Seeding Data
    print("Seeding database values...")
    
    # Seeding users
    users_data = [
        ('admin@gmail.com', 'Romi Geodesi (Admin)', 'admin', 'NusaGIS-2026', 'PC/Desktop', 'Online', '123'),
        ('visitor@gmail.com', 'Pengunjung (Visitor)', 'visitor', 'NusaGIS-2026', 'PC/Desktop', 'Online', '123'),
        ('surveyor1@gmail.com', 'Ahmad Surveyor', 'user', 'NusaGIS-2026', 'Mobile Android', 'Online', '123')
    ]
    cursor.executemany(
        "INSERT INTO users (email, name, role, license, device, status, password) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s)",
        users_data
    )

    # Seeding licenses
    licenses_data = [
        ('NusaGIS-2026', 'PT. Geodesi Nusantara', 10, 3, 'Active'),
        ('NusaGIS-TEMP', 'CV. Map Jaya Mandiri', 3, 0, 'Active')
    ]
    cursor.executemany(
        "INSERT INTO licenses (code, client, quota, used, status) VALUES (%s, %s, %s, %s, %s)",
        licenses_data
    )

    # Seeding leads
    leads_data = [
        ('Budiono Siregar', 'Sewa RTK & WebGIS', '+628129482810', '2026-06-08'),
        ('Siti Aisyah', 'Lisensi Tim (20 Seats)', 'siti.aisyah@petatambang.id', '2026-06-09')
    ]
    cursor.executemany(
        "INSERT INTO leads (name, interest, contact, date) VALUES (%s, %s, %s, %s)",
        leads_data
    )

    conn.commit()
    cursor.close()
    conn.close()
    print("Database seeding completed successfully.")

if __name__ == '__main__':
    main()
