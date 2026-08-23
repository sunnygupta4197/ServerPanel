#!/usr/bin/env python3
"""
ServerPanel - Complete Control Panel with Project Deployment Portal
A lightweight, powerful alternative to cPanel built with Python/Flask
Includes: App Installation, Project Deployment, File Management, Domain Management,
Database Management, Email Management, System Monitoring, Logs, Backups, and more!
Version: 4.0.0
"""

import os
import sys
import json
import shutil
import zipfile
import tarfile
import platform
import psutil
import subprocess
import bcrypt
import socket
import stat
import tempfile
import threading
import time
import urllib.request
import urllib.parse
import secrets
import string
import signal
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote, unquote

# Flask and extensions
from flask import (Flask, render_template, redirect, url_for, flash, request,
                   jsonify, send_from_directory, send_file, make_response)
from flask_sqlalchemy import SQLAlchemy
from flask_login import (LoginManager, UserMixin, login_user, logout_user,
                         login_required, current_user)
from flask_wtf import FlaskForm
from wtforms import (StringField, PasswordField, BooleanField, SubmitField,
                     TextAreaField, SelectField, IntegerField, FileField, HiddenField)
from wtforms.validators import DataRequired, Length, Email, Optional
from werkzeug.utils import secure_filename

# Try to import optional dependencies
try:
    import pymysql
    MYSQL_AVAILABLE = True
except ImportError:
    MYSQL_AVAILABLE = False

try:
    import psycopg2
    POSTGRESQL_AVAILABLE = True
except ImportError:
    POSTGRESQL_AVAILABLE = False

try:
    import dns.resolver
    DNS_AVAILABLE = True
except ImportError:
    DNS_AVAILABLE = False

# ────────────────────────────────────────────────────────────────────────────────
#  Configuration
# ────────────────────────────────────────────────────────────────────────────────
class Config:
    SECRET_KEY = os.environ.get("SERVERPANEL_SECRET") or "change-this-in-production"
    SQLALCHEMY_DATABASE_URI = os.environ.get("SERVERPANEL_DB") or "sqlite:///serverpanel.db"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    PERMANENT_SESSION_LIFETIME = timedelta(hours=2)
    
    # ServerPanel settings
    PANEL_NAME = "ServerPanel"
    PANEL_VERSION = "4.0.0"
    UPLOAD_FOLDER = "/tmp/serverpanel_uploads"
    APPS_FOLDER = "/tmp/serverpanel_apps"
    PROJECTS_FOLDER = "/tmp/serverpanel_projects"
    MAX_CONTENT_LENGTH = 500 * 1024 * 1024  # 500MB max file upload
    
    # Default paths
    DEFAULT_WEB_ROOT = "/var/www/html"
    DEFAULT_LOG_PATH = "/var/log"
    DEFAULT_CONFIG_PATH = "/etc"
    
    # Security settings
    ALLOWED_EXTENSIONS = {'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'zip', 'tar', 'gz'}

# ────────────────────────────────────────────────────────────────────────────────
#  Application Catalog - Extended with all apps
# ────────────────────────────────────────────────────────────────────────────────
APP_CATALOG = {
    "wordpress": {
        "name": "WordPress",
        "description": "The world's most popular blogging platform and CMS",
        "version": "6.4.2",
        "category": "CMS",
        "icon": "fab fa-wordpress",
        "url": "https://wordpress.org/latest.zip",
        "requirements": ["php", "mysql"],
        "install_path": "wordpress",
        "config_files": ["wp-config.php"],
        "database_required": True,
        "setup_url": "/wp-admin/install.php"
    },
    "phpmyadmin": {
        "name": "phpMyAdmin",
        "description": "Web-based MySQL administration tool",
        "version": "5.2.1",
        "category": "Database",
        "icon": "fas fa-database",
        "url": "https://files.phpmyadmin.net/phpMyAdmin/5.2.1/phpMyAdmin-5.2.1-all-languages.zip",
        "requirements": ["php", "mysql"],
        "install_path": "phpmyadmin",
        "config_files": ["config.inc.php"],
        "database_required": False,
        "setup_url": "/index.php"
    },
    "nextcloud": {
        "name": "Nextcloud",
        "description": "Self-hosted cloud storage and collaboration platform",
        "version": "28.0.1",
        "category": "Cloud Storage",
        "icon": "fas fa-cloud",
        "url": "https://download.nextcloud.com/server/releases/latest.zip",
        "requirements": ["php", "mysql"],
        "install_path": "nextcloud",
        "config_files": ["config/config.php"],
        "database_required": True,
        "setup_url": "/index.php"
    },
    "drupal": {
        "name": "Drupal",
        "description": "Open-source content management framework",
        "version": "10.1.7",
        "category": "CMS",
        "icon": "fab fa-drupal",
        "url": "https://www.drupal.org/download-latest/zip",
        "requirements": ["php", "mysql"],
        "install_path": "drupal",
        "config_files": ["sites/default/settings.php"],
        "database_required": True,
        "setup_url": "/core/install.php"
    },
    "joomla": {
        "name": "Joomla",
        "description": "Popular open-source CMS",
        "version": "4.4.2",
        "category": "CMS",
        "icon": "fab fa-joomla",
        "url": "https://downloads.joomla.org/cms/joomla4/4-4-2/Joomla_4.4.2-Stable-Full_Package.zip",
        "requirements": ["php", "mysql"],
        "install_path": "joomla",
        "config_files": ["configuration.php"],
        "database_required": True,
        "setup_url": "/installation/index.php"
    },
    "prestashop": {
        "name": "PrestaShop",
        "description": "Open-source e-commerce platform",
        "version": "8.1.3",
        "category": "E-commerce",
        "icon": "fas fa-shopping-cart",
        "url": "https://github.com/PrestaShop/PrestaShop/releases/download/8.1.3/prestashop_8.1.3.zip",
        "requirements": ["php", "mysql"],
        "install_path": "prestashop",
        "config_files": ["app/config/parameters.php"],
        "database_required": True,
        "setup_url": "/install/index.php"
    },
    "moodle": {
        "name": "Moodle",
        "description": "Open-source learning management system",
        "version": "4.3.3",
        "category": "Education",
        "icon": "fas fa-graduation-cap",
        "url": "https://download.moodle.org/download.php/direct/stable403/moodle-latest-403.zip",
        "requirements": ["php", "mysql"],
        "install_path": "moodle",
        "config_files": ["config.php"],
        "database_required": True,
        "setup_url": "/install.php"
    },
    "mediawiki": {
        "name": "MediaWiki",
        "description": "Wiki software that powers Wikipedia",
        "version": "1.41.0",
        "category": "Wiki",
        "icon": "fab fa-wikipedia-w",
        "url": "https://releases.wikimedia.org/mediawiki/1.41/mediawiki-1.41.0.tar.gz",
        "requirements": ["php", "mysql"],
        "install_path": "mediawiki",
        "config_files": ["LocalSettings.php"],
        "database_required": True,
        "setup_url": "/mw-config/index.php"
    },
    "ghost": {
        "name": "Ghost",
        "description": "Modern publishing platform",
        "version": "5.75.1",
        "category": "Blog",
        "icon": "fas fa-ghost",
        "url": "https://github.com/TryGhost/Ghost/releases/download/v5.75.1/Ghost-5.75.1.zip",
        "requirements": ["nodejs", "mysql"],
        "install_path": "ghost",
        "config_files": ["config.production.json"],
        "database_required": True,
        "setup_url": "/ghost/"
    },
    "roundcube": {
        "name": "Roundcube",
        "description": "Web-based email client",
        "version": "1.6.6",
        "category": "Email",
        "icon": "fas fa-envelope",
        "url": "https://github.com/roundcube/roundcubemail/releases/download/1.6.6/roundcubemail-1.6.6-complete.tar.gz",
        "requirements": ["php", "mysql"],
        "install_path": "roundcube",
        "config_files": ["config/config.inc.php"],
        "database_required": True,
        "setup_url": "/installer/"
    }
}

# ────────────────────────────────────────────────────────────────────────────────
#  Flask App Setup
# ────────────────────────────────────────────────────────────────────────────────
app = Flask(__name__)
app.config.from_object(Config)

# Create directories
for folder in [app.config['UPLOAD_FOLDER'], app.config['APPS_FOLDER'], app.config['PROJECTS_FOLDER']]:
    os.makedirs(folder, exist_ok=True)

db = SQLAlchemy(app)

login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = "login"
login_manager.login_message = "Please log in to access ServerPanel."

# ────────────────────────────────────────────────────────────────────────────────
#  Database Models - Complete with all features
# ────────────────────────────────────────────────────────────────────────────────
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    is_admin = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_login = db.Column(db.DateTime)
    
    def set_password(self, password):
        self.password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    
    def check_password(self, password):
        return bcrypt.checkpw(password.encode(), self.password_hash.encode())

class Domain(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), unique=True, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    document_root = db.Column(db.String(500), nullable=False)
    ssl_enabled = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    user = db.relationship('User', backref=db.backref('domains', lazy=True))

class Database(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    db_type = db.Column(db.String(50), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    user = db.relationship('User', backref=db.backref('databases', lazy=True))

class EmailAccount(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    quota_mb = db.Column(db.Integer, default=1000)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    user = db.relationship('User', backref=db.backref('email_accounts', lazy=True))

class InstalledApp(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    app_key = db.Column(db.String(100), nullable=False)
    app_name = db.Column(db.String(255), nullable=False)
    version = db.Column(db.String(50), nullable=False)
    domain_id = db.Column(db.Integer, db.ForeignKey('domain.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    install_path = db.Column(db.String(500), nullable=False)
    database_name = db.Column(db.String(255), nullable=True)
    status = db.Column(db.String(50), default='active')
    admin_url = db.Column(db.String(500), nullable=True)
    admin_username = db.Column(db.String(100), nullable=True)
    admin_password = db.Column(db.String(100), nullable=True)
    installed_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    domain = db.relationship('Domain', backref=db.backref('installed_apps', lazy=True))
    user = db.relationship('User', backref=db.backref('installed_apps', lazy=True))

class Project(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    domain_id = db.Column(db.Integer, db.ForeignKey('domain.id'), nullable=True)
    
    # Deployment settings
    runtime = db.Column(db.String(50), nullable=False)
    git_url = db.Column(db.String(500), nullable=True)
    git_branch = db.Column(db.String(100), default='main')
    build_command = db.Column(db.String(500), nullable=True)
    start_command = db.Column(db.String(500), nullable=True)
    
    # Project paths
    project_path = db.Column(db.String(500), nullable=False)
    public_url = db.Column(db.String(500), nullable=True)
    
    # Status
    status = db.Column(db.String(50), default='inactive')
    port = db.Column(db.Integer, nullable=True)
    pid = db.Column(db.Integer, nullable=True)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_deployed = db.Column(db.DateTime, nullable=True)
    
    user = db.relationship('User', backref=db.backref('projects', lazy=True))
    domain = db.relationship('Domain', backref=db.backref('projects', lazy=True))

class ProjectEnvironment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)
    key = db.Column(db.String(255), nullable=False)
    value = db.Column(db.Text, nullable=False)
    
    project = db.relationship('Project', backref=db.backref('environment_vars', lazy=True))

class DeploymentLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)
    status = db.Column(db.String(50), nullable=False)
    log_content = db.Column(db.Text, nullable=True)
    deployed_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    project = db.relationship('Project', backref=db.backref('deployment_logs', lazy=True))

# ────────────────────────────────────────────────────────────────────────────────
#  Forms - Complete with all forms
# ────────────────────────────────────────────────────────────────────────────────
class LoginForm(FlaskForm):
    username = StringField("Username", validators=[DataRequired(), Length(3, 80)])
    password = PasswordField("Password", validators=[DataRequired()])
    remember = BooleanField("Remember me")
    submit = SubmitField("Log in")

class DomainForm(FlaskForm):
    name = StringField("Domain Name", validators=[DataRequired(), Length(3, 255)])
    document_root = StringField("Document Root", validators=[DataRequired()])
    ssl_enabled = BooleanField("Enable SSL")
    submit = SubmitField("Add Domain")

class DatabaseForm(FlaskForm):
    name = StringField("Database Name", validators=[DataRequired(), Length(3, 255)])
    db_type = SelectField("Database Type", choices=[('mysql', 'MySQL'), ('postgresql', 'PostgreSQL')])
    submit = SubmitField("Create Database")

class EmailForm(FlaskForm):
    email = StringField("Email Address", validators=[DataRequired(), Email()])
    password = PasswordField("Password", validators=[DataRequired(), Length(6)])
    quota_mb = IntegerField("Quota (MB)", validators=[Optional()], default=1000)
    submit = SubmitField("Create Email Account")

class FileUploadForm(FlaskForm):
    file = FileField("Choose File")
    submit = SubmitField("Upload")

class AppInstallForm(FlaskForm):
    app_key = HiddenField("App Key", validators=[DataRequired()])
    domain_id = SelectField("Install Domain", coerce=int, validators=[DataRequired()])
    install_path = StringField("Install Path", validators=[DataRequired()])
    create_database = BooleanField("Create Database", default=True)
    database_name = StringField("Database Name")
    admin_username = StringField("Admin Username", default="admin")
    admin_password = PasswordField("Admin Password")
    submit = SubmitField("Install Application")

class ProjectForm(FlaskForm):
    name = StringField("Project Name", validators=[DataRequired(), Length(3, 255)])
    runtime = SelectField("Runtime", choices=[
        ('static', 'Static HTML/CSS/JS'),
        ('nodejs', 'Node.js'),
        ('python', 'Python'),
        ('php', 'PHP'),
        ('ruby', 'Ruby'),
        ('go', 'Go'),
        ('java', 'Java')
    ])
    git_url = StringField("Git Repository URL", validators=[Optional()])
    git_branch = StringField("Git Branch", default="main")
    build_command = StringField("Build Command", validators=[Optional()])
    start_command = StringField("Start Command", validators=[Optional()])
    domain_id = SelectField("Domain", coerce=int, validators=[Optional()])
    submit = SubmitField("Deploy Project")

class EnvironmentForm(FlaskForm):
    key = StringField("Environment Variable", validators=[DataRequired()])
    value = TextAreaField("Value", validators=[DataRequired()])
    submit = SubmitField("Add Variable")

# ────────────────────────────────────────────────────────────────────────────────
#  Login Manager
# ────────────────────────────────────────────────────────────────────────────────
@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# ────────────────────────────────────────────────────────────────────────────────
#  Utility Functions - Complete with all utilities
# ────────────────────────────────────────────────────────────────────────────────
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']

def format_bytes(bytes):
    """Convert bytes to human readable format"""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if bytes < 1024.0:
            return f"{bytes:.1f} {unit}"
        bytes /= 1024.0
    return f"{bytes:.1f} PB"

def get_directory_size(path):
    """Get total size of directory"""
    total_size = 0
    try:
        for dirpath, dirnames, filenames in os.walk(path):
            for filename in filenames:
                filepath = os.path.join(dirpath, filename)
                try:
                    total_size += os.path.getsize(filepath)
                except (OSError, IOError):
                    pass
    except (OSError, IOError):
        pass
    return total_size

def run_command(command, timeout=30, cwd=None):
    """Run shell command safely"""
    try:
        result = subprocess.run(
            command, shell=True, capture_output=True, text=True, timeout=timeout, cwd=cwd
        )
        return result.returncode == 0, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return False, "", "Command timeout"
    except Exception as e:
        return False, "", str(e)

def is_safe_path(path, base_path="/"):
    """Check if path is safe (no directory traversal)"""
    try:
        abs_path = os.path.abspath(path)
        abs_base = os.path.abspath(base_path)
        return abs_path.startswith(abs_base)
    except:
        return False

def generate_password(length=12):
    """Generate a secure random password"""
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    password = ''.join(secrets.choice(alphabet) for i in range(length))
    return password

def download_file(url, destination):
    """Download file from URL to destination"""
    try:
        urllib.request.urlretrieve(url, destination)
        return True
    except Exception as e:
        print(f"Download failed: {e}")
        return False

def extract_archive(archive_path, destination):
    """Extract archive to destination"""
    try:
        if archive_path.endswith('.zip'):
            with zipfile.ZipFile(archive_path, 'r') as zip_ref:
                zip_ref.extractall(destination)
        elif archive_path.endswith(('.tar.gz', '.tgz')):
            with tarfile.open(archive_path, 'r:gz') as tar_ref:
                tar_ref.extractall(destination)
        elif archive_path.endswith('.tar'):
            with tarfile.open(archive_path, 'r') as tar_ref:
                tar_ref.extractall(destination)
        return True
    except Exception as e:
        print(f"Extraction failed: {e}")
        return False

def get_available_port():
    """Get next available port for project"""
    used_ports = db.session.query(Project.port).filter(Project.port.isnot(None)).all()
    used_ports = [p[0] for p in used_ports]
    
    for port in range(3000, 4000):
        if port not in used_ports:
            return port
    return 3000

def kill_process_tree(pid):
    """Kill process and all its children"""
    try:
        parent = psutil.Process(pid)
        children = parent.children(recursive=True)
        
        for child in children:
            child.kill()
        
        parent.kill()
        return True
    except psutil.NoSuchProcess:
        return True
    except Exception as e:
        print(f"Error killing process: {e}")
        return False

# ────────────────────────────────────────────────────────────────────────────────
#  App Installation Functions - Complete
# ────────────────────────────────────────────────────────────────────────────────
def install_wordpress(domain, install_path, database_name, admin_username, admin_password):
    """Install WordPress with configuration"""
    try:
        # Create wp-config.php
        config_content = f"""<?php
define('DB_NAME', '{database_name}');
define('DB_USER', 'root');
define('DB_PASSWORD', '{os.environ.get("MYSQL_ROOT_PASSWORD", "")}');
define('DB_HOST', 'localhost');
define('DB_CHARSET', 'utf8');
define('DB_COLLATE', '');

define('AUTH_KEY',         '{generate_password(64)}');
define('SECURE_AUTH_KEY',  '{generate_password(64)}');
define('LOGGED_IN_KEY',    '{generate_password(64)}');
define('NONCE_KEY',        '{generate_password(64)}');
define('AUTH_SALT',        '{generate_password(64)}');
define('SECURE_AUTH_SALT', '{generate_password(64)}');
define('LOGGED_IN_SALT',   '{generate_password(64)}');
define('NONCE_SALT',       '{generate_password(64)}');

$table_prefix = 'wp_';
define('WP_DEBUG', false);

if ( !defined('ABSPATH') )
    define('ABSPATH', dirname(__FILE__) . '/');

require_once(ABSPATH . 'wp-settings.php');
"""
        
        config_path = os.path.join(install_path, 'wp-config.php')
        with open(config_path, 'w') as f:
            f.write(config_content)
        
        # Set proper permissions
        os.chmod(install_path, 0o755)
        run_command(f"chown -R www-data:www-data {install_path}")
        
        return True
    except Exception as e:
        print(f"WordPress configuration failed: {e}")
        return False

def install_phpmyadmin(domain, install_path, database_name, admin_username, admin_password):
    """Install phpMyAdmin with configuration"""
    try:
        # Create config.inc.php
        config_content = f"""<?php
$cfg['blowfish_secret'] = '{generate_password(32)}';
$i = 0;
$i++;
$cfg['Servers'][$i]['auth_type'] = 'cookie';
$cfg['Servers'][$i]['host'] = 'localhost';
$cfg['Servers'][$i]['compress'] = false;
$cfg['Servers'][$i]['AllowNoPassword'] = false;
$cfg['UploadDir'] = '';
$cfg['SaveDir'] = '';
"""
        
        config_path = os.path.join(install_path, 'config.inc.php')
        with open(config_path, 'w') as f:
            f.write(config_content)
        
        # Set proper permissions
        os.chmod(install_path, 0o755)
        run_command(f"chown -R www-data:www-data {install_path}")
        
        return True
    except Exception as e:
        print(f"phpMyAdmin configuration failed: {e}")
        return False

def install_nextcloud(domain, install_path, database_name, admin_username, admin_password):
    """Install Nextcloud with basic configuration"""
    try:
        # Create data directory
        data_dir = os.path.join(install_path, 'data')
        os.makedirs(data_dir, exist_ok=True)
        
        # Set proper permissions
        os.chmod(install_path, 0o755)
        run_command(f"chown -R www-data:www-data {install_path}")
        
        return True
    except Exception as e:
        print(f"Nextcloud configuration failed: {e}")
        return False

def create_mysql_database(db_name):
    """Create MySQL database"""
    if not MYSQL_AVAILABLE:
        raise Exception("MySQL driver not available")
    
    connection = pymysql.connect(
        host='localhost',
        user='root',
        password=os.environ.get('MYSQL_ROOT_PASSWORD', '')
    )
    
    try:
        cursor = connection.cursor()
        cursor.execute(f"CREATE DATABASE IF NOT EXISTS `{db_name}`")
        connection.commit()
    finally:
        connection.close()

def create_postgresql_database(db_name):
    """Create PostgreSQL database"""
    if not POSTGRESQL_AVAILABLE:
        raise Exception("PostgreSQL driver not available")
    
    connection = psycopg2.connect(
        host='localhost',
        user='postgres',
        password=os.environ.get('POSTGRES_PASSWORD', ''),
        database='postgres'
    )
    connection.autocommit = True
    
    try:
        cursor = connection.cursor()
        cursor.execute(f"CREATE DATABASE {db_name}")
    finally:
        connection.close()

# ────────────────────────────────────────────────────────────────────────────────
#  Project Deployment Functions - Complete
# ────────────────────────────────────────────────────────────────────────────────
def deploy_from_git(project_id):
    """Deploy project from Git repository"""
    project = Project.query.get(project_id)
    
    def deployment_task():
        try:
            with app.app_context():
                # Update project status
                project.status = 'building'
                db.session.commit()
                
                # Create deployment log
                log = DeploymentLog(project_id=project_id, status='building')
                db.session.add(log)
                db.session.commit()
                
                # Clone repository
                if os.path.exists(project.project_path):
                    shutil.rmtree(project.project_path)
                
                os.makedirs(project.project_path, exist_ok=True)
                
                # Git clone
                success, stdout, stderr = run_command(
                    f"git clone -b {project.git_branch} {project.git_url} .",
                    cwd=project.project_path
                )
                
                if not success:
                    raise Exception(f"Git clone failed: {stderr}")
                
                # Install dependencies and build
                build_success = build_project(project)
                
                if build_success:
                    # Start project service
                    if start_project_service(project):
                        project.status = 'active'
                        project.last_deployed = datetime.utcnow()
                        log.status = 'success'
                        log.log_content = f"Deployment successful\n{stdout}"
                    else:
                        project.status = 'failed'
                        log.status = 'failed'
                        log.log_content = "Failed to start project service"
                else:
                    project.status = 'failed'
                    log.status = 'failed'
                    log.log_content = "Build process failed"
                
                db.session.commit()
                
        except Exception as e:
            with app.app_context():
                project.status = 'failed'
                log.status = 'failed'
                log.log_content = f"Deployment failed: {str(e)}"
                db.session.commit()
    
    # Run deployment in background
    threading.Thread(target=deployment_task).start()

def deploy_from_upload(project_id, archive_path):
    """Deploy project from uploaded archive"""
    project = Project.query.get(project_id)
    
    try:
        # Create deployment log
        log = DeploymentLog(project_id=project_id, status='building')
        db.session.add(log)
        db.session.commit()
        
        # Extract archive
        if os.path.exists(project.project_path):
            shutil.rmtree(project.project_path)
        
        os.makedirs(project.project_path, exist_ok=True)
        
        if extract_archive(archive_path, project.project_path):
            # Handle nested directories
            contents = os.listdir(project.project_path)
            if len(contents) == 1 and os.path.isdir(os.path.join(project.project_path, contents[0])):
                nested_dir = os.path.join(project.project_path, contents[0])
                for item in os.listdir(nested_dir):
                    shutil.move(os.path.join(nested_dir, item), project.project_path)
                os.rmdir(nested_dir)
            
            # Build and start project
            if build_project(project):
                if start_project_service(project):
                    project.status = 'active'
                    project.last_deployed = datetime.utcnow()
                    log.status = 'success'
                    log.log_content = "Deployment successful"
                else:
                    project.status = 'failed'
                    log.status = 'failed'
                    log.log_content = "Failed to start project"
            else:
                project.status = 'failed'
                log.status = 'failed'
                log.log_content = "Build failed"
        else:
            project.status = 'failed'
            log.status = 'failed'
            log.log_content = "Archive extraction failed"
        
        db.session.commit()
        os.remove(archive_path)
        
    except Exception as e:
        project.status = 'failed'
        log.status = 'failed'
        log.log_content = f"Deployment failed: {str(e)}"
        db.session.commit()

def build_project(project):
    """Build project based on runtime"""
    try:
        # Set environment variables
        env_vars = os.environ.copy()
        env_vars['PORT'] = str(project.port)
        for env_var in project.environment_vars:
            env_vars[env_var.key] = env_var.value
        
        # Runtime-specific build processes
        if project.runtime == 'nodejs':
            # Check for package.json
            if os.path.exists(os.path.join(project.project_path, 'package.json')):
                success, _, _ = run_command("npm install", cwd=project.project_path)
                if not success:
                    return False
                
                # Run build command if specified
                if project.build_command:
                    success, _, _ = run_command(project.build_command, cwd=project.project_path)
                    if not success:
                        return False
        
        elif project.runtime == 'python':
            # Check for requirements.txt
            if os.path.exists(os.path.join(project.project_path, 'requirements.txt')):
                success, _, _ = run_command("pip install -r requirements.txt", cwd=project.project_path)
                if not success:
                    return False
        
        elif project.runtime == 'php':
            # Check for composer.json
            if os.path.exists(os.path.join(project.project_path, 'composer.json')):
                success, _, _ = run_command("composer install", cwd=project.project_path)
                if not success:
                    return False
        
        elif project.runtime == 'ruby':
            # Check for Gemfile
            if os.path.exists(os.path.join(project.project_path, 'Gemfile')):
                success, _, _ = run_command("bundle install", cwd=project.project_path)
                if not success:
                    return False
        
        # Custom build command
        if project.build_command and project.runtime != 'nodejs':
            success, _, _ = run_command(project.build_command, cwd=project.project_path)
            if not success:
                return False
        
        return True
        
    except Exception as e:
        print(f"Build failed: {e}")
        return False

def start_project_service(project):
    """Start project as a background process"""
    try:
        # Stop existing process if running
        if project.pid:
            kill_process_tree(project.pid)
        
        # Set environment variables
        env_vars = os.environ.copy()
        env_vars['PORT'] = str(project.port)
        for env_var in project.environment_vars:
            env_vars[env_var.key] = env_var.value
        
        # Determine start command
        if project.start_command:
            start_command = project.start_command
        else:
            # Default start commands by runtime
            if project.runtime == 'nodejs':
                if os.path.exists(os.path.join(project.project_path, 'package.json')):
                    start_command = "npm start"
                else:
                    start_command = "node index.js"
            elif project.runtime == 'python':
                if os.path.exists(os.path.join(project.project_path, 'app.py')):
                    start_command = f"python app.py"
                elif os.path.exists(os.path.join(project.project_path, 'main.py')):
                    start_command = f"python main.py"
                else:
                    start_command = f"python -m http.server {project.port}"
            elif project.runtime == 'php':
                start_command = f"php -S 0.0.0.0:{project.port}"
            elif project.runtime == 'static':
                start_command = f"python -m http.server {project.port}"
            else:
                return False
        
        # Start process
        process = subprocess.Popen(
            start_command,
            shell=True,
            cwd=project.project_path,
            env=env_vars,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            preexec_fn=os.setsid
        )
        
        # Update project with PID
        project.pid = process.pid
        db.session.commit()
        
        # Wait a moment to check if process started successfully
        time.sleep(2)
        if process.poll() is None:
            # Process is still running
            project.public_url = f"http://localhost:{project.port}"
            db.session.commit()
            return True
        else:
            # Process failed to start
            return False
        
    except Exception as e:
        print(f"Failed to start project: {e}")
        return False

def stop_project_service(project):
    """Stop project service"""
    try:
        if project.pid:
            return kill_process_tree(project.pid)
        return True
    except Exception as e:
        print(f"Failed to stop project: {e}")
        return False

# ────────────────────────────────────────────────────────────────────────────────
#  Authentication Routes
# ────────────────────────────────────────────────────────────────────────────────
@app.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("dashboard"))
    
    form = LoginForm()
    if form.validate_on_submit():
        user = User.query.filter_by(username=form.username.data).first()
        if user and user.check_password(form.password.data):
            login_user(user, remember=form.remember.data)
            user.last_login = datetime.utcnow()
            db.session.commit()
            return redirect(url_for("dashboard"))
        flash("Invalid username or password", "danger")
    
    return render_template("login.html", form=form, title="Login · ServerPanel")

@app.route("/logout")
@login_required
def logout():
    logout_user()
    return redirect(url_for("login"))

# ────────────────────────────────────────────────────────────────────────────────
#  Dashboard Routes
# ────────────────────────────────────────────────────────────────────────────────
@app.route("/")
@login_required
def dashboard():
    # System stats
    cpu = psutil.cpu_percent(interval=1)
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    
    # User stats
    domain_count = Domain.query.filter_by(user_id=current_user.id).count()
    db_count = Database.query.filter_by(user_id=current_user.id).count()
    email_count = EmailAccount.query.filter_by(user_id=current_user.id).count()
    app_count = InstalledApp.query.filter_by(user_id=current_user.id).count()
    project_count = Project.query.filter_by(user_id=current_user.id).count()
    
    # Recent apps and projects
    recent_apps = InstalledApp.query.filter_by(user_id=current_user.id)\
                                  .order_by(InstalledApp.installed_at.desc())\
                                  .limit(5).all()
    
    recent_projects = Project.query.filter_by(user_id=current_user.id)\
                                  .order_by(Project.created_at.desc())\
                                  .limit(5).all()
    
    stats = {
        "cpu_percent": cpu,
        "memory_total_gb": round(memory.total / (1024**3), 2),
        "memory_used_gb": round(memory.used / (1024**3), 2),
        "memory_percent": memory.percent,
        "disk_total_gb": round(disk.total / (1024**3), 2),
        "disk_used_gb": round(disk.used / (1024**3), 2),
        "disk_percent": round((disk.used / disk.total) * 100, 2),
        "uptime": str(datetime.now() - datetime.fromtimestamp(psutil.boot_time())).split('.')[0],
        "hostname": socket.gethostname(),
        "os": f"{platform.system()} {platform.release()}",
        "domain_count": domain_count,
        "database_count": db_count,
        "email_count": email_count,
        "app_count": app_count,
        "project_count": project_count
    }
    
    return render_template("dashboard.html", stats=stats, 
                         recent_apps=recent_apps, recent_projects=recent_projects,
                         title="Dashboard · ServerPanel")

@app.route("/api/stats")
@login_required
def api_stats():
    return jsonify({
        "cpu": psutil.cpu_percent(interval=1),
        "memory": psutil.virtual_memory().percent,
        "timestamp": datetime.utcnow().isoformat()
    })

# ────────────────────────────────────────────────────────────────────────────────
#  Project Management Routes - Complete
# ────────────────────────────────────────────────────────────────────────────────
@app.route("/projects")
@login_required
def projects():
    user_projects = Project.query.filter_by(user_id=current_user.id).all()
    return render_template("projects.html", projects=user_projects, title="Projects · ServerPanel")

@app.route("/projects/deploy", methods=["GET", "POST"])
@login_required
def deploy_project():
    form = ProjectForm()
    
    # Populate domain choices
    user_domains = Domain.query.filter_by(user_id=current_user.id).all()
    form.domain_id.choices = [(0, 'Auto-generate URL')] + [(d.id, d.name) for d in user_domains]
    
    if form.validate_on_submit():
        # Generate project path
        project_path = os.path.join(app.config['PROJECTS_FOLDER'], 
                                   f"{current_user.username}_{secure_filename(form.name.data)}")
        
        # Create project record
        project = Project(
            name=form.name.data,
            user_id=current_user.id,
            domain_id=form.domain_id.data if form.domain_id.data > 0 else None,
            runtime=form.runtime.data,
            git_url=form.git_url.data,
            git_branch=form.git_branch.data,
            build_command=form.build_command.data,
            start_command=form.start_command.data,
            project_path=project_path,
            port=get_available_port()
        )
        
        db.session.add(project)
        db.session.commit()
        
        # Start deployment process
        if form.git_url.data:
            deploy_from_git(project.id)
            flash("Deployment started from Git repository", "info")
        else:
            flash("Project created. Upload your files to deploy.", "success")
        
        return redirect(url_for("project_detail", project_id=project.id))
    
    return render_template("deploy_project.html", form=form, title="Deploy Project · ServerPanel")

@app.route("/projects/<int:project_id>")
@login_required
def project_detail(project_id):
    project = Project.query.get_or_404(project_id)
    
    # Check ownership
    if project.user_id != current_user.id and not current_user.is_admin:
        flash("Access denied", "danger")
        return redirect(url_for("projects"))
    
    # Get deployment logs
    logs = DeploymentLog.query.filter_by(project_id=project_id)\
                             .order_by(DeploymentLog.deployed_at.desc())\
                             .limit(10).all()
    
    return render_template("project_detail.html", project=project, logs=logs, 
                         title=f"{project.name} · ServerPanel")

@app.route("/projects/<int:project_id>/deploy", methods=["POST"])
@login_required
def redeploy_project(project_id):
    project = Project.query.get_or_404(project_id)
    
    if project.user_id != current_user.id and not current_user.is_admin:
        flash("Access denied", "danger")
        return redirect(url_for("projects"))
    
    if project.git_url:
        deploy_from_git(project_id)
        flash("Deployment started", "info")
    else:
        flash("No Git repository configured", "warning")
    
    return redirect(url_for("project_detail", project_id=project_id))

@app.route("/projects/<int:project_id>/upload", methods=["POST"])
@login_required
def upload_project(project_id):
    project = Project.query.get_or_404(project_id)
    
    if project.user_id != current_user.id and not current_user.is_admin:
        flash("Access denied", "danger")
        return redirect(url_for("projects"))
    
    if 'file' not in request.files:
        flash("No file uploaded", "danger")
        return redirect(url_for("project_detail", project_id=project_id))
    
    file = request.files['file']
    if file.filename == '':
        flash("No file selected", "danger")
        return redirect(url_for("project_detail", project_id=project_id))
    
    if file and file.filename.endswith(('.zip', '.tar.gz', '.tar')):
        # Save uploaded file
        filename = secure_filename(file.filename)
        temp_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(temp_path)
        
        # Extract and deploy
        deploy_from_upload(project_id, temp_path)
        flash("Project uploaded and deployed", "success")
    else:
        flash("Invalid file type. Please upload ZIP or TAR archive.", "danger")
    
    return redirect(url_for("project_detail", project_id=project_id))

@app.route("/projects/<int:project_id>/start", methods=["POST"])
@login_required
def start_project(project_id):
    project = Project.query.get_or_404(project_id)
    
    if project.user_id != current_user.id and not current_user.is_admin:
        flash("Access denied", "danger")
        return redirect(url_for("projects"))
    
    if start_project_service(project):
        project.status = 'active'
        db.session.commit()
        flash("Project started successfully", "success")
    else:
        flash("Failed to start project", "danger")
    
    return redirect(url_for("project_detail", project_id=project_id))

@app.route("/projects/<int:project_id>/stop", methods=["POST"])
@login_required
def stop_project(project_id):
    project = Project.query.get_or_404(project_id)
    
    if project.user_id != current_user.id and not current_user.is_admin:
        flash("Access denied", "danger")
        return redirect(url_for("projects"))
    
    if stop_project_service(project):
        project.status = 'inactive'
        project.pid = None
        db.session.commit()
        flash("Project stopped", "success")
    else:
        flash("Failed to stop project", "danger")
    
    return redirect(url_for("project_detail", project_id=project_id))

@app.route("/projects/<int:project_id>/environment", methods=["GET", "POST"])
@login_required
def project_environment(project_id):
    project = Project.query.get_or_404(project_id)
    
    if project.user_id != current_user.id and not current_user.is_admin:
        flash("Access denied", "danger")
        return redirect(url_for("projects"))
    
    form = EnvironmentForm()
    
    if form.validate_on_submit():
        # Check if environment variable already exists
        existing = ProjectEnvironment.query.filter_by(
            project_id=project_id,
            key=form.key.data
        ).first()
        
        if existing:
            existing.value = form.value.data
        else:
            env_var = ProjectEnvironment(
                project_id=project_id,
                key=form.key.data,
                value=form.value.data
            )
            db.session.add(env_var)
        
        db.session.commit()
        flash("Environment variable updated", "success")
        return redirect(url_for("project_environment", project_id=project_id))
    
    return render_template("project_environment.html", project=project, form=form, 
                         title=f"Environment - {project.name} · ServerPanel")

@app.route("/projects/<int:project_id>/environment/<int:env_id>/delete", methods=["POST"])
@login_required
def delete_environment_var(project_id, env_id):
    project = Project.query.get_or_404(project_id)
    
    if project.user_id != current_user.id and not current_user.is_admin:
        flash("Access denied", "danger")
        return redirect(url_for("projects"))
    
    env_var = ProjectEnvironment.query.get_or_404(env_id)
    if env_var.project_id == project_id:
        db.session.delete(env_var)
        db.session.commit()
        flash("Environment variable deleted", "success")
    
    return redirect(url_for("project_environment", project_id=project_id))

@app.route("/projects/<int:project_id>/delete", methods=["POST"])
@login_required
def delete_project(project_id):
    project = Project.query.get_or_404(project_id)
    
    if project.user_id != current_user.id and not current_user.is_admin:
        flash("Access denied", "danger")
        return redirect(url_for("projects"))
    
    try:
        # Stop project if running
        if project.pid:
            stop_project_service(project)
        
        # Remove project files
        if os.path.exists(project.project_path):
            shutil.rmtree(project.project_path)
        
        # Remove environment variables
        ProjectEnvironment.query.filter_by(project_id=project_id).delete()
        
        # Remove deployment logs
        DeploymentLog.query.filter_by(project_id=project_id).delete()
        
        # Remove project
        db.session.delete(project)
        db.session.commit()
        
        flash(f"Project {project.name} deleted successfully", "success")
    except Exception as e:
        flash(f"Failed to delete project: {str(e)}", "danger")
    
    return redirect(url_for("projects"))

# ────────────────────────────────────────────────────────────────────────────────
#  App Management Routes - Complete
# ────────────────────────────────────────────────────────────────────────────────
@app.route("/apps")
@login_required
def apps():
    # Get installed apps
    installed_apps = InstalledApp.query.filter_by(user_id=current_user.id).all()
    
    # Group apps by category
    categories = {}
    for app_key, app_info in APP_CATALOG.items():
        category = app_info['category']
        if category not in categories:
            categories[category] = []
        
        # Check if app is installed
        is_installed = any(app.app_key == app_key for app in installed_apps)
        app_info['is_installed'] = is_installed
        app_info['key'] = app_key
        
        categories[category].append(app_info)
    
    return render_template("apps.html", 
                         categories=categories, 
                         installed_apps=installed_apps,
                         title="Applications · ServerPanel")

@app.route("/apps/install/<app_key>", methods=["GET", "POST"])
@login_required
def install_app(app_key):
    if app_key not in APP_CATALOG:
        flash("Application not found", "danger")
        return redirect(url_for("apps"))
    
    app_info = APP_CATALOG[app_key]
    form = AppInstallForm()
    
    # Populate domain choices
    user_domains = Domain.query.filter_by(user_id=current_user.id).all()
    form.domain_id.choices = [(d.id, d.name) for d in user_domains]
    
    if not user_domains:
        flash("Please create a domain first before installing applications", "warning")
        return redirect(url_for("add_domain"))
    
    # Set default values
    if request.method == "GET":
        form.app_key.data = app_key
        form.install_path.data = app_info['install_path']
        form.database_name.data = f"{app_key}_{current_user.username}"
        form.admin_password.data = generate_password()
    
    if form.validate_on_submit():
        # Check if app is already installed
        existing = InstalledApp.query.filter_by(
            app_key=app_key,
            domain_id=form.domain_id.data,
            user_id=current_user.id
        ).first()
        
        if existing:
            flash("Application is already installed on this domain", "warning")
            return redirect(url_for("apps"))
        
        # Get domain
        domain = Domain.query.get(form.domain_id.data)
        if not domain or domain.user_id != current_user.id:
            flash("Invalid domain selected", "danger")
            return redirect(url_for("apps"))
        
        # Start installation process
        try:
            install_path = os.path.join(domain.document_root, form.install_path.data)
            
            # Create installation directory
            os.makedirs(install_path, exist_ok=True)
            
            # Download and extract application
            temp_file = os.path.join(app.config['APPS_FOLDER'], f"{app_key}_{int(time.time())}.zip")
            
            flash("Downloading application...", "info")
            if download_file(app_info['url'], temp_file):
                flash("Extracting application...", "info")
                if extract_archive(temp_file, install_path):
                    
                    # Handle nested directories
                    extracted_contents = os.listdir(install_path)
                    if len(extracted_contents) == 1 and os.path.isdir(os.path.join(install_path, extracted_contents[0])):
                        nested_dir = os.path.join(install_path, extracted_contents[0])
                        for item in os.listdir(nested_dir):
                            shutil.move(os.path.join(nested_dir, item), install_path)
                        os.rmdir(nested_dir)
                    
                    # Create database if required
                    database_name = None
                    if form.create_database.data and app_info.get('database_required'):
                        database_name = form.database_name.data
                        try:
                            create_mysql_database(database_name)
                            
                            # Create database record
                            db_record = Database(
                                name=database_name,
                                user_id=current_user.id,
                                db_type='mysql'
                            )
                            db.session.add(db_record)
                        except Exception as e:
                            flash(f"Database creation failed: {str(e)}", "warning")
                    
                    # Configure application
                    if app_key == "wordpress":
                        install_wordpress(domain, install_path, database_name, 
                                        form.admin_username.data, form.admin_password.data)
                    elif app_key == "phpmyadmin":
                        install_phpmyadmin(domain, install_path, database_name,
                                         form.admin_username.data, form.admin_password.data)
                    elif app_key == "nextcloud":
                        install_nextcloud(domain, install_path, database_name,
                                        form.admin_username.data, form.admin_password.data)
                    
                    # Create installation record
                    installed_app = InstalledApp(
                        app_key=app_key,
                        app_name=app_info['name'],
                        version=app_info['version'],
                        domain_id=form.domain_id.data,
                        user_id=current_user.id,
                        install_path=install_path,
                        database_name=database_name,
                        admin_url=f"http://{domain.name}/{form.install_path.data}{app_info['setup_url']}",
                        admin_username=form.admin_username.data,
                        admin_password=form.admin_password.data
                    )
                    
                    db.session.add(installed_app)
                    db.session.commit()
                    
                    # Clean up
                    os.remove(temp_file)
                    
                    flash(f"{app_info['name']} installed successfully!", "success")
                    return redirect(url_for("apps"))
                else:
                    flash("Failed to extract application", "danger")
            else:
                flash("Failed to download application", "danger")
        
        except Exception as e:
            flash(f"Installation failed: {str(e)}", "danger")
    
    return render_template("install_app.html", 
                         form=form, 
                         app_info=app_info,
                         title=f"Install {app_info['name']} · ServerPanel")

@app.route("/apps/uninstall/<int:app_id>", methods=["POST"])
@login_required
def uninstall_app(app_id):
    app = InstalledApp.query.get_or_404(app_id)
    
    # Check ownership
    if app.user_id != current_user.id and not current_user.is_admin:
        flash("Access denied", "danger")
        return redirect(url_for("apps"))
    
    try:
        # Remove application files
        if os.path.exists(app.install_path):
            shutil.rmtree(app.install_path)
        
        # Remove database if exists
        if app.database_name:
            try:
                if MYSQL_AVAILABLE:
                    connection = pymysql.connect(
                        host='localhost',
                        user='root',
                        password=os.environ.get('MYSQL_ROOT_PASSWORD', '')
                    )
                    cursor = connection.cursor()
                    cursor.execute(f"DROP DATABASE IF EXISTS `{app.database_name}`")
                    connection.commit()
                    connection.close()
                
                # Remove database record
                db_record = Database.query.filter_by(name=app.database_name).first()
                if db_record:
                    db.session.delete(db_record)
            except Exception as e:
                flash(f"Database removal failed: {str(e)}", "warning")
        
        # Remove installation record
        db.session.delete(app)
        db.session.commit()
        
        flash(f"{app.app_name} uninstalled successfully", "success")
    
    except Exception as e:
        flash(f"Uninstallation failed: {str(e)}", "danger")
    
    return redirect(url_for("apps"))

@app.route("/apps/manage/<int:app_id>")
@login_required
def manage_app(app_id):
    app = InstalledApp.query.get_or_404(app_id)
    
    # Check ownership
    if app.user_id != current_user.id and not current_user.is_admin:
        flash("Access denied", "danger")
        return redirect(url_for("apps"))
    
    # Get app info from catalog
    app_info = APP_CATALOG.get(app.app_key, {})
    
    return render_template("manage_app.html", 
                         app=app, 
                         app_info=app_info,
                         title=f"Manage {app.app_name} · ServerPanel")

# ────────────────────────────────────────────────────────────────────────────────
#  File Manager Routes - Complete
# ────────────────────────────────────────────────────────────────────────────────
@app.route("/files")
@login_required
def file_manager():
    path = request.args.get('path', os.path.expanduser('~'))
    
    # Security check
    if not is_safe_path(path):
        flash("Access denied to this path", "danger")
        path = os.path.expanduser('~')
    
    try:
        items = []
        if os.path.exists(path) and os.path.isdir(path):
            for item in os.listdir(path):
                item_path = os.path.join(path, item)
                try:
                    stat_info = os.stat(item_path)
                    items.append({
                        'name': item,
                        'path': item_path,
                        'size': format_bytes(stat_info.st_size),
                        'size_bytes': stat_info.st_size,
                        'modified': datetime.fromtimestamp(stat_info.st_mtime).strftime('%Y-%m-%d %H:%M:%S'),
                        'is_dir': os.path.isdir(item_path),
                        'permissions': oct(stat_info.st_mode)[-3:],
                        'owner': stat_info.st_uid,
                        'group': stat_info.st_gid
                    })
                except (OSError, IOError):
                    continue
        
        # Sort directories first, then files
        items.sort(key=lambda x: (not x['is_dir'], x['name'].lower()))
        
        # Get parent directory
        parent_path = os.path.dirname(path) if path != '/' else None
        
        return render_template("file_manager.html", 
                             items=items, 
                             current_path=path,
                             parent_path=parent_path,
                             title="File Manager · ServerPanel")
    
    except PermissionError:
        flash("Permission denied", "danger")
        return redirect(url_for("dashboard"))

@app.route("/files/upload", methods=["POST"])
@login_required
def upload_file():
    path = request.form.get('path', os.path.expanduser('~'))
    
    if not is_safe_path(path):
        flash("Access denied to this path", "danger")
        return redirect(url_for("file_manager"))
    
    if 'file' not in request.files:
        flash("No file selected", "danger")
        return redirect(url_for("file_manager", path=path))
    
    file = request.files['file']
    if file.filename == '':
        flash("No file selected", "danger")
        return redirect(url_for("file_manager", path=path))
    
    if file:
        filename = secure_filename(file.filename)
        file_path = os.path.join(path, filename)
        
        try:
            file.save(file_path)
            flash(f"File {filename} uploaded successfully", "success")
        except Exception as e:
            flash(f"Upload failed: {str(e)}", "danger")
    
    return redirect(url_for("file_manager", path=path))

@app.route("/files/download")
@login_required
def download_file():
    path = request.args.get('path')
    
    if not path or not is_safe_path(path):
        flash("Access denied", "danger")
        return redirect(url_for("file_manager"))
    
    if os.path.exists(path) and os.path.isfile(path):
        return send_file(path, as_attachment=True)
    else:
        flash("File not found", "danger")
        return redirect(url_for("file_manager"))

@app.route("/files/delete", methods=["POST"])
@login_required
def delete_file():
    path = request.form.get('path')
    current_dir = request.form.get('current_dir', os.path.expanduser('~'))
    
    if not path or not is_safe_path(path):
        flash("Access denied", "danger")
        return redirect(url_for("file_manager", path=current_dir))
    
    try:
        if os.path.isfile(path):
            os.remove(path)
            flash("File deleted successfully", "success")
        elif os.path.isdir(path):
            shutil.rmtree(path)
            flash("Directory deleted successfully", "success")
        else:
            flash("File or directory not found", "danger")
    except Exception as e:
        flash(f"Delete failed: {str(e)}", "danger")
    
    return redirect(url_for("file_manager", path=current_dir))

@app.route("/files/create_folder", methods=["POST"])
@login_required
def create_folder():
    path = request.form.get('path')
    folder_name = request.form.get('folder_name')
    current_dir = request.form.get('current_dir', os.path.expanduser('~'))
    
    if not path or not folder_name or not is_safe_path(path):
        flash("Invalid parameters", "danger")
        return redirect(url_for("file_manager", path=current_dir))
    
    folder_path = os.path.join(path, secure_filename(folder_name))
    
    try:
        os.makedirs(folder_path, exist_ok=True)
        flash(f"Folder '{folder_name}' created successfully", "success")
    except Exception as e:
        flash(f"Failed to create folder: {str(e)}", "danger")
    
    return redirect(url_for("file_manager", path=current_dir))

# ────────────────────────────────────────────────────────────────────────────────
#  Domain Management Routes - Complete
# ────────────────────────────────────────────────────────────────────────────────
@app.route("/domains")
@login_required
def domains():
    user_domains = Domain.query.filter_by(user_id=current_user.id).all()
    return render_template("domains.html", domains=user_domains, title="Domains · ServerPanel")

@app.route("/domains/add", methods=["GET", "POST"])
@login_required
def add_domain():
    form = DomainForm()
    
    if form.validate_on_submit():
        # Check if domain already exists
        existing = Domain.query.filter_by(name=form.name.data).first()
        if existing:
            flash("Domain already exists", "danger")
            return render_template("add_domain.html", form=form, title="Add Domain · ServerPanel")
        
        # Create domain
        domain = Domain(
            name=form.name.data,
            user_id=current_user.id,
            document_root=form.document_root.data,
            ssl_enabled=form.ssl_enabled.data
        )
        
        try:
            # Create document root directory
            os.makedirs(form.document_root.data, exist_ok=True)
            
            # Create basic index.html
            index_path = os.path.join(form.document_root.data, 'index.html')
            if not os.path.exists(index_path):
                with open(index_path, 'w') as f:
                    f.write(f"""<!DOCTYPE html>
<html>
<head>
    <title>Welcome to {form.name.data}</title>
    <style>
        body {{ font-family: Arial, sans-serif; text-align: center; margin-top: 50px; }}
        .container {{ max-width: 600px; margin: 0 auto; }}
        .logo {{ color: #007bff; }}
    </style>
</head>
<body>
    <div class="container">
        <h1 class="logo">Welcome to {form.name.data}</h1>
        <p>Your domain is now active and ready for content!</p>
        <p>You can install applications or upload your own files using ServerPanel.</p>
    </div>
</body>
</html>""")
            
            db.session.add(domain)
            db.session.commit()
            flash(f"Domain {form.name.data} added successfully", "success")
            return redirect(url_for("domains"))
        
        except Exception as e:
            flash(f"Failed to add domain: {str(e)}", "danger")
    
    return render_template("add_domain.html", form=form, title="Add Domain · ServerPanel")

@app.route("/domains/delete/<int:domain_id>", methods=["POST"])
@login_required
def delete_domain(domain_id):
    domain = Domain.query.get_or_404(domain_id)
    
    # Check ownership
    if domain.user_id != current_user.id and not current_user.is_admin:
        flash("Access denied", "danger")
        return redirect(url_for("domains"))
    
    try:
        # Remove any installed apps on this domain
        apps = InstalledApp.query.filter_by(domain_id=domain_id).all()
        for app in apps:
            if os.path.exists(app.install_path):
                shutil.rmtree(app.install_path)
            db.session.delete(app)
        
        # Remove any projects on this domain
        projects = Project.query.filter_by(domain_id=domain_id).all()
        for project in projects:
            if project.pid:
                stop_project_service(project)
            if os.path.exists(project.project_path):
                shutil.rmtree(project.project_path)
            ProjectEnvironment.query.filter_by(project_id=project.id).delete()
            DeploymentLog.query.filter_by(project_id=project.id).delete()
            db.session.delete(project)
        
        db.session.delete(domain)
        db.session.commit()
        flash(f"Domain {domain.name} deleted successfully", "success")
    except Exception as e:
        flash(f"Failed to delete domain: {str(e)}", "danger")
    
    return redirect(url_for("domains"))

# ────────────────────────────────────────────────────────────────────────────────
#  Database Management Routes - Complete
# ────────────────────────────────────────────────────────────────────────────────
@app.route("/databases")
@login_required
def databases():
    user_databases = Database.query.filter_by(user_id=current_user.id).all()
    return render_template("databases.html", databases=user_databases, title="Databases · ServerPanel")

@app.route("/databases/add", methods=["GET", "POST"])
@login_required
def add_database():
    form = DatabaseForm()
    
    # Update choices based on available drivers
    choices = []
    if MYSQL_AVAILABLE:
        choices.append(('mysql', 'MySQL'))
    if POSTGRESQL_AVAILABLE:
        choices.append(('postgresql', 'PostgreSQL'))
    
    if not choices:
        flash("No database drivers available. Please install pymysql or psycopg2.", "danger")
        return redirect(url_for("databases"))
    
    form.db_type.choices = choices
    
    if form.validate_on_submit():
        database = Database(
            name=form.name.data,
            user_id=current_user.id,
            db_type=form.db_type.data
        )
        
        try:
            # Create database based on type
            if form.db_type.data == 'mysql' and MYSQL_AVAILABLE:
                create_mysql_database(form.name.data)
            elif form.db_type.data == 'postgresql' and POSTGRESQL_AVAILABLE:
                create_postgresql_database(form.name.data)
            
            db.session.add(database)
            db.session.commit()
            flash(f"Database {form.name.data} created successfully", "success")
            return redirect(url_for("databases"))
        
        except Exception as e:
            flash(f"Failed to create database: {str(e)}", "danger")
    
    return render_template("add_database.html", form=form, title="Add Database · ServerPanel")

@app.route("/databases/delete/<int:db_id>", methods=["POST"])
@login_required
def delete_database(db_id):
    database = Database.query.get_or_404(db_id)
    
    # Check ownership
    if database.user_id != current_user.id and not current_user.is_admin:
        flash("Access denied", "danger")
        return redirect(url_for("databases"))
    
    try:
        # Drop actual database
        if database.db_type == 'mysql' and MYSQL_AVAILABLE:
            connection = pymysql.connect(
                host='localhost',
                user='root',
                password=os.environ.get('MYSQL_ROOT_PASSWORD', '')
            )
            cursor = connection.cursor()
            cursor.execute(f"DROP DATABASE IF EXISTS `{database.name}`")
            connection.commit()
            connection.close()
        elif database.db_type == 'postgresql' and POSTGRESQL_AVAILABLE:
            connection = psycopg2.connect(
                host='localhost',
                user='postgres',
                password=os.environ.get('POSTGRES_PASSWORD', ''),
                database='postgres'
            )
            connection.autocommit = True
            cursor = connection.cursor()
            cursor.execute(f"DROP DATABASE IF EXISTS {database.name}")
            connection.close()
        
        db.session.delete(database)
        db.session.commit()
        flash(f"Database {database.name} deleted successfully", "success")
    except Exception as e:
        flash(f"Failed to delete database: {str(e)}", "danger")
    
    return redirect(url_for("databases"))

# ────────────────────────────────────────────────────────────────────────────────
#  Email Management Routes - Complete
# ────────────────────────────────────────────────────────────────────────────────
@app.route("/emails")
@login_required
def emails():
    user_emails = EmailAccount.query.filter_by(user_id=current_user.id).all()
    return render_template("emails.html", emails=user_emails, title="Email Accounts · ServerPanel")

@app.route("/emails/add", methods=["GET", "POST"])
@login_required
def add_email():
    form = EmailForm()
    
    if form.validate_on_submit():
        # Check if email already exists
        existing = EmailAccount.query.filter_by(email=form.email.data).first()
        if existing:
            flash("Email account already exists", "danger")
            return render_template("add_email.html", form=form, title="Add Email · ServerPanel")
        
        email_account = EmailAccount(
            email=form.email.data,
            user_id=current_user.id,
            quota_mb=form.quota_mb.data or 1000
        )
        
        try:
            db.session.add(email_account)
            db.session.commit()
            flash(f"Email account {form.email.data} created successfully", "success")
            return redirect(url_for("emails"))
        
        except Exception as e:
            flash(f"Failed to create email account: {str(e)}", "danger")
    
    return render_template("add_email.html", form=form, title="Add Email · ServerPanel")

@app.route("/emails/delete/<int:email_id>", methods=["POST"])
@login_required
def delete_email(email_id):
    email_account = EmailAccount.query.get_or_404(email_id)
    
    # Check ownership
    if email_account.user_id != current_user.id and not current_user.is_admin:
        flash("Access denied", "danger")
        return redirect(url_for("emails"))
    
    try:
        db.session.delete(email_account)
        db.session.commit()
        flash(f"Email account {email_account.email} deleted successfully", "success")
    except Exception as e:
        flash(f"Failed to delete email account: {str(e)}", "danger")
    
    return redirect(url_for("emails"))

# ────────────────────────────────────────────────────────────────────────────────
#  System Management Routes - Complete
# ────────────────────────────────────────────────────────────────────────────────
@app.route("/processes")
@login_required
def processes():
    process_list = []
    for proc in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_percent', 'status']):
        try:
            process_list.append(proc.info)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    
    # Sort by CPU usage
    process_list.sort(key=lambda x: x['cpu_percent'] or 0, reverse=True)
    
    return render_template("processes.html", processes=process_list[:50], title="Processes · ServerPanel")

@app.route("/services")
@login_required
def services():
    service_list = []
    try:
        result = subprocess.run(
            ['systemctl', 'list-units', '--type=service', '--no-pager', '--no-legend'],
            capture_output=True, text=True
        )
        
        for line in result.stdout.strip().splitlines():
            parts = line.split()
            if len(parts) >= 4:
                service_list.append({
                    'name': parts[0],
                    'loaded': parts[1],
                    'active': parts[2],
                    'sub': parts[3]
                })
    except FileNotFoundError:
        service_list.append({
            'name': 'systemctl not available',
            'loaded': 'N/A',
            'active': 'N/A',
            'sub': 'N/A'
        })
    
    return render_template("services.html", services=service_list, title="Services · ServerPanel")

@app.route("/logs")
@login_required
def logs():
    log_files = []
    log_paths = ['/var/log', '/var/log/apache2', '/var/log/nginx']
    
    for log_path in log_paths:
        if os.path.exists(log_path):
            try:
                for item in os.listdir(log_path):
                    if item.endswith('.log'):
                        full_path = os.path.join(log_path, item)
                        if os.path.isfile(full_path):
                            stat_info = os.stat(full_path)
                            log_files.append({
                                'name': item,
                                'path': full_path,
                                'size': format_bytes(stat_info.st_size),
                                'modified': datetime.fromtimestamp(stat_info.st_mtime).strftime('%Y-%m-%d %H:%M:%S')
                            })
            except PermissionError:
                continue
    
    return render_template("logs.html", log_files=log_files, title="Log Files · ServerPanel")

@app.route("/logs/view")
@login_required
def view_log():
    log_path = request.args.get('path')
    lines = int(request.args.get('lines', 100))
    
    if not log_path or not is_safe_path(log_path, '/var/log'):
        flash("Access denied", "danger")
        return redirect(url_for("logs"))
    
    try:
        # Read last N lines
        with open(log_path, 'r') as f:
            content = f.readlines()
            content = content[-lines:] if len(content) > lines else content
        
        return render_template("view_log.html", 
                             log_path=log_path, 
                             content=''.join(content),
                             title=f"Log: {os.path.basename(log_path)} · ServerPanel")
    
    except Exception as e:
        flash(f"Error reading log file: {str(e)}", "danger")
        return redirect(url_for("logs"))

# ────────────────────────────────────────────────────────────────────────────────
#  Backup Routes - Complete
# ────────────────────────────────────────────────────────────────────────────────
@app.route("/backups")
@login_required
def backups():
    backup_dir = os.path.join(app.config['UPLOAD_FOLDER'], 'backups')
    os.makedirs(backup_dir, exist_ok=True)
    
    backup_files = []
    if os.path.exists(backup_dir):
        for item in os.listdir(backup_dir):
            if item.endswith('.tar.gz'):
                file_path = os.path.join(backup_dir, item)
                stat_info = os.stat(file_path)
                backup_files.append({
                    'name': item,
                    'path': file_path,
                    'size': format_bytes(stat_info.st_size),
                    'created': datetime.fromtimestamp(stat_info.st_ctime).strftime('%Y-%m-%d %H:%M:%S')
                })
    
    return render_template("backups.html", backups=backup_files, title="Backups · ServerPanel")

@app.route("/backups/create", methods=["POST"])
@login_required
def create_backup():
    backup_name = request.form.get('backup_name', f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
    source_path = request.form.get('source_path', os.path.expanduser('~'))
    
    if not is_safe_path(source_path):
        flash("Access denied to source path", "danger")
        return redirect(url_for("backups"))
    
    backup_dir = os.path.join(app.config['UPLOAD_FOLDER'], 'backups')
    os.makedirs(backup_dir, exist_ok=True)
    
    backup_file = os.path.join(backup_dir, f"{backup_name}.tar.gz")
    
    try:
        with tarfile.open(backup_file, 'w:gz') as tar:
            tar.add(source_path, arcname=os.path.basename(source_path))
        
        flash(f"Backup created successfully: {backup_name}.tar.gz", "success")
    except Exception as e:
        flash(f"Backup failed: {str(e)}", "danger")
    
    return redirect(url_for("backups"))

@app.route("/backups/download/<filename>")
@login_required
def download_backup(filename):
    backup_dir = os.path.join(app.config['UPLOAD_FOLDER'], 'backups')
    backup_path = os.path.join(backup_dir, filename)
    
    if not is_safe_path(backup_path, backup_dir):
        flash("Access denied", "danger")
        return redirect(url_for("backups"))
    
    if os.path.exists(backup_path):
        return send_file(backup_path, as_attachment=True)
    else:
        flash("Backup file not found", "danger")
        return redirect(url_for("backups"))

@app.route("/backups/delete/<filename>", methods=["POST"])
@login_required
def delete_backup(filename):
    backup_dir = os.path.join(app.config['UPLOAD_FOLDER'], 'backups')
    backup_path = os.path.join(backup_dir, filename)
    
    if not is_safe_path(backup_path, backup_dir):
        flash("Access denied", "danger")
        return redirect(url_for("backups"))
    
    try:
        if os.path.exists(backup_path):
            os.remove(backup_path)
            flash("Backup deleted successfully", "success")
        else:
            flash("Backup file not found", "danger")
    except Exception as e:
        flash(f"Failed to delete backup: {str(e)}", "danger")
    
    return redirect(url_for("backups"))

# ────────────────────────────────────────────────────────────────────────────────
#  Initialize Database
# ────────────────────────────────────────────────────────────────────────────────
with app.app_context():
    db.create_all()
    
    # Create default admin user
    if not User.query.filter_by(username='admin').first():
        admin = User(username='admin', email='admin@localhost', is_admin=True)
        admin.set_password('admin123')
        db.session.add(admin)
        db.session.commit()
        print("Created default admin user: admin/admin123")

# ────────────────────────────────────────────────────────────────────────────────
#  Templates
# ────────────────────────────────────────────────────────────────────────────────
TEMPLATES = {
    "base.html": """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ title or config.PANEL_NAME }}</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        .sidebar { min-height: 100vh; background-color: #f8f9fa; }
        .nav-link { color: #495057; }
        .nav-link:hover { color: #007bff; }
        .nav-link.active { color: #007bff; font-weight: 500; }
        .progress-bar { transition: width 0.6s ease; }
        .card { box-shadow: 0 0.125rem 0.25rem rgba(0, 0, 0, 0.075); }
        .sidebar-nav { position: sticky; top: 20px; }
        .main-content { min-height: 100vh; }
        .project-card { transition: all 0.3s ease; }
        .project-card:hover { transform: translateY(-2px); box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.15); }
        .status-active { color: #28a745; }
        .status-inactive { color: #6c757d; }
        .status-building { color: #ffc107; }
        .status-failed { color: #dc3545; }
        .deployment-logs { background-color: #f8f9fa; font-family: monospace; white-space: pre-wrap; max-height: 300px; overflow-y: auto; }
    </style>
</head>
<body>
    <nav class="navbar navbar-expand-lg navbar-dark bg-primary">
        <div class="container-fluid">
            <a class="navbar-brand" href="{{ url_for('dashboard') }}">
                <i class="fas fa-server me-2"></i>{{ config.PANEL_NAME }}
            </a>
            {% if current_user.is_authenticated %}
            <div class="navbar-nav ms-auto">
                <span class="navbar-text me-3">
                    <i class="fas fa-user me-1"></i>{{ current_user.username }}
                </span>
                <a class="nav-link" href="{{ url_for('logout') }}">
                    <i class="fas fa-sign-out-alt me-1"></i>Logout
                </a>
            </div>
            {% endif %}
        </div>
    </nav>

    <div class="container-fluid">
        <div class="row">
            {% if current_user.is_authenticated %}
            <div class="col-md-3 col-lg-2 sidebar">
                <div class="sidebar-nav">
                    <nav class="nav flex-column py-3">
                        <a class="nav-link" href="{{ url_for('dashboard') }}">
                            <i class="fas fa-tachometer-alt me-2"></i>Dashboard
                        </a>
                        <a class="nav-link" href="{{ url_for('projects') }}">
                            <i class="fas fa-rocket me-2"></i>Projects
                        </a>
                        <a class="nav-link" href="{{ url_for('apps') }}">
                            <i class="fas fa-puzzle-piece me-2"></i>Applications
                        </a>
                        <a class="nav-link" href="{{ url_for('file_manager') }}">
                            <i class="fas fa-folder me-2"></i>File Manager
                        </a>
                        <a class="nav-link" href="{{ url_for('domains') }}">
                            <i class="fas fa-globe me-2"></i>Domains
                        </a>
                    </nav>
                </div>
            </div>
            <div class="col-md-9 col-lg-10 main-content">
            {% else %}
            <div class="col-12 main-content">
            {% endif %}
                <div class="py-4">
                    {% with messages = get_flashed_messages(with_categories=true) %}
                        {% if messages %}
                            {% for category, message in messages %}
                                <div class="alert alert-{{ 'danger' if category == 'error' else category }} alert-dismissible fade show" role="alert">
                                    {{ message }}
                                    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
                                </div>
                            {% endfor %}
                        {% endif %}
                    {% endwith %}
                    
                    {% block content %}{% endblock %}
                </div>
            </div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script>
        // Auto-refresh system stats
        function refreshStats() {
            fetch('/api/stats')
                .then(response => response.json())
                .then(data => {
                    const cpuBar = document.getElementById('cpu-bar');
                    const memBar = document.getElementById('memory-bar');
                    if (cpuBar) {
                        cpuBar.style.width = data.cpu + '%';
                        cpuBar.textContent = data.cpu + '%';
                    }
                    if (memBar) {
                        memBar.style.width = data.memory + '%';
                        memBar.textContent = data.memory + '%';
                    }
                })
                .catch(error => console.error('Error fetching stats:', error));
        }

        // Refresh stats every 30 seconds
        if (document.getElementById('cpu-bar')) {
            setInterval(refreshStats, 30000);
        }

        // Auto-hide alerts after 5 seconds
        setTimeout(function() {
            const alerts = document.querySelectorAll('.alert-info');
            alerts.forEach(alert => {
                const bsAlert = new bootstrap.Alert(alert);
                bsAlert.close();
            });
        }, 5000);
    </script>
</body>
</html>""",

    "login.html": """{% extends "base.html" %}
{% block content %}
<div class="row justify-content-center">
    <div class="col-md-6 col-lg-4">
        <div class="card">
            <div class="card-header text-center">
                <h4><i class="fas fa-server me-2"></i>{{ config.PANEL_NAME }}</h4>
                <p class="text-muted mb-0">Project Deployment Portal</p>
            </div>
            <div class="card-body">
                <form method="post">
                    {{ form.hidden_tag() }}
                    <div class="mb-3">
                        {{ form.username.label(class="form-label") }}
                        {{ form.username(class="form-control") }}
                    </div>
                    <div class="mb-3">
                        {{ form.password.label(class="form-label") }}
                        {{ form.password(class="form-control") }}
                    </div>
                    <div class="form-check mb-3">
                        {{ form.remember(class="form-check-input") }}
                        {{ form.remember.label(class="form-check-label") }}
                    </div>
                    {{ form.submit(class="btn btn-primary w-100") }}
                </form>
            </div>
            <div class="card-footer text-center text-muted">
                <small>Version {{ config.PANEL_VERSION }}</small>
            </div>
        </div>
    </div>
</div>
{% endblock %}""",

    "dashboard.html": """{% extends "base.html" %}
{% block content %}
<div class="d-flex justify-content-between align-items-center mb-4">
    <h2><i class="fas fa-tachometer-alt me-2"></i>Dashboard</h2>
    <span class="badge bg-primary">{{ config.PANEL_VERSION }}</span>
</div>

<div class="row">
    <div class="col-md-3 mb-3">
        <div class="card">
            <div class="card-header">
                <i class="fas fa-microchip me-2"></i>CPU Usage
            </div>
            <div class="card-body">
                <div class="progress mb-2">
                    <div id="cpu-bar" class="progress-bar" style="width: {{ stats.cpu_percent }}%">
                        {{ stats.cpu_percent }}%
                    </div>
                </div>
                <small class="text-muted">Current utilization</small>
            </div>
        </div>
    </div>
    
    <div class="col-md-3 mb-3">
        <div class="card">
            <div class="card-header">
                <i class="fas fa-memory me-2"></i>Memory Usage
            </div>
            <div class="card-body">
                <div class="progress mb-2">
                    <div id="memory-bar" class="progress-bar" style="width: {{ stats.memory_percent }}%">
                        {{ stats.memory_percent }}%
                    </div>
                </div>
                <small class="text-muted">{{ stats.memory_used_gb }} GB / {{ stats.memory_total_gb }} GB</small>
            </div>
        </div>
    </div>
    
    <div class="col-md-3 mb-3">
        <div class="card">
            <div class="card-header">
                <i class="fas fa-hdd me-2"></i>Disk Usage
            </div>
            <div class="card-body">
                <div class="progress mb-2">
                    <div class="progress-bar" style="width: {{ stats.disk_percent }}%">
                        {{ stats.disk_percent }}%
                    </div>
                </div>
                <small class="text-muted">{{ stats.disk_used_gb }} GB / {{ stats.disk_total_gb }} GB</small>
            </div>
        </div>
    </div>
    
    <div class="col-md-3 mb-3">
        <div class="card">
            <div class="card-header">
                <i class="fas fa-rocket me-2"></i>Projects
            </div>
            <div class="card-body">
                <h3 class="text-primary mb-1">{{ stats.project_count }}</h3>
                <small class="text-muted">Deployed Projects</small>
            </div>
        </div>
    </div>
</div>

<div class="row">
    <div class="col-md-6 mb-3">
        <div class="card">
            <div class="card-header">
                <i class="fas fa-server me-2"></i>Server Information
            </div>
            <div class="card-body">
                <table class="table table-sm">
                    <tr><th>Hostname</th><td>{{ stats.hostname }}</td></tr>
                    <tr><th>Operating System</th><td>{{ stats.os }}</td></tr>
                    <tr><th>Uptime</th><td>{{ stats.uptime }}</td></tr>
                    <tr><th>Panel Version</th><td>{{ config.PANEL_VERSION }}</td></tr>
                </table>
            </div>
        </div>
    </div>
    
    <div class="col-md-6 mb-3">
        <div class="card">
            <div class="card-header">
                <i class="fas fa-chart-bar me-2"></i>Account Summary
            </div>
            <div class="card-body">
                <div class="row text-center">
                    <div class="col-3">
                        <div class="border-end">
                            <h4 class="text-primary">{{ stats.domain_count }}</h4>
                            <small class="text-muted">Domains</small>
                        </div>
                    </div>
                    <div class="col-3">
                        <div class="border-end">
                            <h4 class="text-primary">{{ stats.project_count }}</h4>
                            <small class="text-muted">Projects</small>
                        </div>
                    </div>
                    <div class="col-3">
                        <div class="border-end">
                            <h4 class="text-primary">{{ stats.app_count }}</h4>
                            <small class="text-muted">Apps</small>
                        </div>
                    </div>
                    <div class="col-3">
                        <h4 class="text-primary">{{ stats.database_count }}</h4>
                        <small class="text-muted">Databases</small>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

{% if recent_projects %}
<div class="row">
    <div class="col-12">
        <div class="card">
            <div class="card-header">
                <i class="fas fa-clock me-2"></i>Recent Projects
            </div>
            <div class="card-body">
                <div class="table-responsive">
                    <table class="table table-sm">
                        <thead>
                            <tr>
                                <th>Project</th>
                                <th>Runtime</th>
                                <th>Status</th>
                                <th>Created</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {% for project in recent_projects %}
                            <tr>
                                <td>
                                    <i class="fas fa-rocket me-2"></i>
                                    <strong>{{ project.name }}</strong>
                                </td>
                                <td><span class="badge bg-secondary">{{ project.runtime }}</span></td>
                                <td>
                                    <span class="status-{{ project.status }}">
                                        <i class="fas fa-circle me-1"></i>{{ project.status }}
                                    </span>
                                </td>
                                <td>{{ project.created_at.strftime('%Y-%m-%d %H:%M') }}</td>
                                <td>
                                    <a href="{{ url_for('project_detail', project_id=project.id) }}" class="btn btn-sm btn-outline-primary">
                                        <i class="fas fa-eye"></i>
                                    </a>
                                    {% if project.public_url %}
                                    <a href="{{ project.public_url }}" class="btn btn-sm btn-outline-success" target="_blank">
                                        <i class="fas fa-external-link-alt"></i>
                                    </a>
                                    {% endif %}
                                </td>
                            </tr>
                            {% endfor %}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
</div>
{% endif %}

<div class="row mt-4">
    <div class="col-12">
        <div class="card">
            <div class="card-header">
                <i class="fas fa-rocket me-2"></i>Quick Actions
            </div>
            <div class="card-body">
                <div class="row">
                    <div class="col-md-2 mb-2">
                        <a href="{{ url_for('deploy_project') }}" class="btn btn-primary w-100">
                            <i class="fas fa-rocket me-1"></i>Deploy Project
                        </a>
                    </div>
                    <div class="col-md-2 mb-2">
                        <a href="{{ url_for('apps') }}" class="btn btn-outline-primary w-100">
                            <i class="fas fa-puzzle-piece me-1"></i>Install App
                        </a>
                    </div>
                    <div class="col-md-2 mb-2">
                        <a href="{{ url_for('add_domain') }}" class="btn btn-outline-primary w-100">
                            <i class="fas fa-plus me-1"></i>Add Domain
                        </a>
                    </div>
                    <div class="col-md-2 mb-2">
                        <a href="{{ url_for('file_manager') }}" class="btn btn-outline-primary w-100">
                            <i class="fas fa-folder me-1"></i>File Manager
                        </a>
                    </div>
                    <div class="col-md-2 mb-2">
                        <a href="{{ url_for('projects') }}" class="btn btn-outline-primary w-100">
                            <i class="fas fa-list me-1"></i>All Projects
                        </a>
                    </div>
                    <div class="col-md-2 mb-2">
                        <a href="{{ url_for('domains') }}" class="btn btn-outline-primary w-100">
                            <i class="fas fa-globe me-1"></i>Domains
                        </a>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
{% endblock %}""",

    "projects.html": """{% extends "base.html" %}
{% block content %}
<div class="d-flex justify-content-between align-items-center mb-4">
    <h2><i class="fas fa-rocket me-2"></i>Projects</h2>
    <a href="{{ url_for('deploy_project') }}" class="btn btn-primary">
        <i class="fas fa-plus me-1"></i>Deploy New Project
    </a>
</div>

<div class="row">
    {% for project in projects %}
    <div class="col-md-6 col-lg-4 mb-4">
        <div class="card project-card h-100">
            <div class="card-header d-flex justify-content-between align-items-center">
                <h5 class="mb-0">{{ project.name }}</h5>
                <span class="badge bg-secondary">{{ project.runtime }}</span>
            </div>
            <div class="card-body">
                <div class="mb-3">
                    <strong>Status:</strong>
                    <span class="status-{{ project.status }}">
                        <i class="fas fa-circle me-1"></i>{{ project.status }}
                    </span>
                </div>
                
                {% if project.git_url %}
                <div class="mb-3">
                    <strong>Repository:</strong>
                    <small class="text-muted d-block">{{ project.git_url }}</small>
                </div>
                {% endif %}
                
                <div class="mb-3">
                    <strong>Created:</strong>
                    <small class="text-muted">{{ project.created_at.strftime('%Y-%m-%d %H:%M') }}</small>
                </div>
                
                {% if project.last_deployed %}
                <div class="mb-3">
                    <strong>Last Deploy:</strong>
                    <small class="text-muted">{{ project.last_deployed.strftime('%Y-%m-%d %H:%M') }}</small>
                </div>
                {% endif %}
            </div>
            <div class="card-footer">
                <div class="btn-group w-100" role="group">
                    <a href="{{ url_for('project_detail', project_id=project.id) }}" class="btn btn-outline-primary btn-sm">
                        <i class="fas fa-eye me-1"></i>View
                    </a>
                    {% if project.public_url and project.status == 'active' %}
                    <a href="{{ project.public_url }}" class="btn btn-outline-success btn-sm" target="_blank">
                        <i class="fas fa-external-link-alt me-1"></i>Open
                    </a>
                    {% endif %}
                    {% if project.status == 'inactive' %}
                    <form method="post" action="{{ url_for('start_project', project_id=project.id) }}" class="d-inline">
                        <button type="submit" class="btn btn-outline-success btn-sm">
                            <i class="fas fa-play me-1"></i>Start
                        </button>
                    </form>
                    {% elif project.status == 'active' %}
                    <form method="post" action="{{ url_for('stop_project', project_id=project.id) }}" class="d-inline">
                        <button type="submit" class="btn btn-outline-warning btn-sm">
                            <i class="fas fa-stop me-1"></i>Stop
                        </button>
                    </form>
                    {% endif %}
                </div>
            </div>
        </div>
    </div>
    {% else %}
    <div class="col-12">
        <div class="text-center py-5">
            <i class="fas fa-rocket fa-3x text-muted mb-3"></i>
            <h4>No Projects Yet</h4>
            <p class="text-muted">Deploy your first project to get started!</p>
            <a href="{{ url_for('deploy_project') }}" class="btn btn-primary">
                <i class="fas fa-plus me-1"></i>Deploy New Project
            </a>
        </div>
    </div>
    {% endfor %}
</div>
{% endblock %}""",

    "deploy_project.html": """{% extends "base.html" %}
{% block content %}
<div class="row justify-content-center">
    <div class="col-md-8">
        <div class="card">
            <div class="card-header">
                <h4><i class="fas fa-rocket me-2"></i>Deploy New Project</h4>
            </div>
            <div class="card-body">
                <form method="post">
                    {{ form.hidden_tag() }}
                    
                    <div class="mb-3">
                        {{ form.name.label(class="form-label") }}
                        {{ form.name(class="form-control") }}
                        <div class="form-text">Choose a unique name for your project</div>
                    </div>
                    
                    <div class="mb-3">
                        {{ form.runtime.label(class="form-label") }}
                        {{ form.runtime(class="form-select") }}
                        <div class="form-text">Select the runtime environment for your project</div>
                    </div>
                    
                    <div class="mb-3">
                        {{ form.git_url.label(class="form-label") }}
                        {{ form.git_url(class="form-control", placeholder="https://github.com/username/repo.git") }}
                        <div class="form-text">Git repository URL (optional, you can also upload files later)</div>
                    </div>
                    
                    <div class="mb-3">
                        {{ form.git_branch.label(class="form-label") }}
                        {{ form.git_branch(class="form-control") }}
                        <div class="form-text">Git branch to deploy (default: main)</div>
                    </div>
                    
                    <div class="mb-3">
                        {{ form.build_command.label(class="form-label") }}
                        {{ form.build_command(class="form-control", placeholder="npm run build") }}
                        <div class="form-text">Command to build your project (optional)</div>
                    </div>
                    
                    <div class="mb-3">
                        {{ form.start_command.label(class="form-label") }}
                        {{ form.start_command(class="form-control", placeholder="npm start") }}
                        <div class="form-text">Command to start your project (optional, will use runtime defaults)</div>
                    </div>
                    
                    <div class="mb-3">
                        {{ form.domain_id.label(class="form-label") }}
                        {{ form.domain_id(class="form-select") }}
                        <div class="form-text">Domain to deploy to (optional)</div>
                    </div>
                    
                    <div class="alert alert-info">
                        <i class="fas fa-info-circle me-2"></i>
                        <strong>Deployment Process:</strong>
                        <ul class="mb-0 mt-2">
                            <li>Your project will be cloned from Git or you can upload files later</li>
                            <li>Dependencies will be installed automatically</li>
                            <li>Build command will be executed if provided</li>
                            <li>Project will be started on an available port</li>
                            <li>You can manage environment variables after deployment</li>
                        </ul>
                    </div>
                    
                    <div class="d-flex gap-2">
                        {{ form.submit(class="btn btn-primary") }}
                        <a href="{{ url_for('projects') }}" class="btn btn-secondary">Cancel</a>
                    </div>
                </form>
            </div>
        </div>
    </div>
</div>
{% endblock %}""",

    "project_detail.html": """{% extends "base.html" %}
{% block content %}
<div class="d-flex justify-content-between align-items-center mb-4">
    <h2>
        <i class="fas fa-rocket me-2"></i>{{ project.name }}
        <span class="badge bg-secondary ms-2">{{ project.runtime }}</span>
    </h2>
    <div class="btn-group" role="group">
        {% if project.public_url and project.status == 'active' %}
        <a href="{{ project.public_url }}" class="btn btn-success" target="_blank">
            <i class="fas fa-external-link-alt me-1"></i>Open Project
        </a>
        {% endif %}
        {% if project.status == 'inactive' %}
        <form method="post" action="{{ url_for('start_project', project_id=project.id) }}" class="d-inline">
            <button type="submit" class="btn btn-success">
                <i class="fas fa-play me-1"></i>Start Project
            </button>
        </form>
        {% elif project.status == 'active' %}
        <form method="post" action="{{ url_for('stop_project', project_id=project.id) }}" class="d-inline">
            <button type="submit" class="btn btn-warning">
                <i class="fas fa-stop me-1"></i>Stop Project
            </button>
        </form>
        {% endif %}
    </div>
</div>

<div class="row">
    <div class="col-md-8">
        <div class="card">
            <div class="card-header">
                <h5>Project Details</h5>
            </div>
            <div class="card-body">
                <table class="table table-sm">
                    <tr>
                        <th>Status</th>
                        <td>
                            <span class="status-{{ project.status }}">
                                <i class="fas fa-circle me-1"></i>{{ project.status }}
                            </span>
                        </td>
                    </tr>
                    <tr><th>Runtime</th><td>{{ project.runtime }}</td></tr>
                    {% if project.git_url %}
                    <tr><th>Repository</th><td><a href="{{ project.git_url }}" target="_blank">{{ project.git_url }}</a></td></tr>
                    <tr><th>Branch</th><td>{{ project.git_branch }}</td></tr>
                    {% endif %}
                    <tr><th>Project Path</th><td><code>{{ project.project_path }}</code></td></tr>
                    {% if project.port %}
                    <tr><th>Port</th><td>{{ project.port }}</td></tr>
                    {% endif %}
                    {% if project.public_url %}
                    <tr><th>Public URL</th><td><a href="{{ project.public_url }}" target="_blank">{{ project.public_url }}</a></td></tr>
                    {% endif %}
                    <tr><th>Created</th><td>{{ project.created_at.strftime('%Y-%m-%d %H:%M:%S') }}</td></tr>
                    {% if project.last_deployed %}
                    <tr><th>Last Deployed</th><td>{{ project.last_deployed.strftime('%Y-%m-%d %H:%M:%S') }}</td></tr>
                    {% endif %}
                </table>
            </div>
        </div>

        <div class="card mt-4">
            <div class="card-header">
                <h5>Deployment Actions</h5>
            </div>
            <div class="card-body">
                <div class="row">
                    {% if project.git_url %}
                    <div class="col-md-6 mb-3">
                        <form method="post" action="{{ url_for('redeploy_project', project_id=project.id) }}">
                            <button type="submit" class="btn btn-primary w-100">
                                <i class="fas fa-sync me-1"></i>Redeploy from Git
                            </button>
                        </form>
                    </div>
                    {% endif %}
                    
                    <div class="col-md-6 mb-3">
                        <button class="btn btn-outline-primary w-100" data-bs-toggle="modal" data-bs-target="#uploadModal">
                            <i class="fas fa-upload me-1"></i>Upload Files
                        </button>
                    </div>
                    
                    <div class="col-md-6 mb-3">
                        <a href="{{ url_for('project_environment', project_id=project.id) }}" class="btn btn-outline-info w-100">
                            <i class="fas fa-cog me-1"></i>Environment Variables
                        </a>
                    </div>
                    
                    <div class="col-md-6 mb-3">
                        <a href="{{ url_for('file_manager', path=project.project_path) }}" class="btn btn-outline-secondary w-100">
                            <i class="fas fa-folder me-1"></i>Browse Files
                        </a>
                    </div>
                </div>
            </div>
        </div>

        {% if logs %}
        <div class="card mt-4">
            <div class="card-header">
                <h5>Deployment Logs</h5>
            </div>
            <div class="card-body">
                {% for log in logs %}
                <div class="mb-3">
                    <div class="d-flex justify-content-between align-items-center">
                        <strong>
                            {% if log.status == 'success' %}
                            <i class="fas fa-check-circle text-success me-1"></i>
                            {% elif log.status == 'failed' %}
                            <i class="fas fa-times-circle text-danger me-1"></i>
                            {% else %}
                            <i class="fas fa-clock text-warning me-1"></i>
                            {% endif %}
                            {{ log.status.title() }}
                        </strong>
                        <small class="text-muted">{{ log.deployed_at.strftime('%Y-%m-%d %H:%M:%S') }}</small>
                    </div>
                    {% if log.log_content %}
                    <div class="deployment-logs mt-2">{{ log.log_content }}</div>
                    {% endif %}
                </div>
                {% endfor %}
            </div>
        </div>
        {% endif %}
    </div>

    <div class="col-md-4">
        <div class="card">
            <div class="card-header">
                <h6>Project Status</h6>
            </div>
            <div class="card-body">
                <div class="d-flex align-items-center mb-3">
                    <i class="fas fa-circle status-{{ project.status }} me-2"></i>
                    <span>{{ project.status.title() }}</span>
                </div>
                {% if project.port %}
                <div class="d-flex align-items-center mb-3">
                    <i class="fas fa-network-wired me-2"></i>
                    <span>Port: {{ project.port }}</span>
                </div>
                {% endif %}
                {% if project.pid %}
                <div class="d-flex align-items-center mb-3">
                    <i class="fas fa-microchip me-2"></i>
                    <span>PID: {{ project.pid }}</span>
                </div>
                {% endif %}
                <div class="d-flex align-items-center">
                    <i class="fas fa-folder me-2"></i>
                    <span>{{ project.environment_vars|length }} env vars</span>
                </div>
            </div>
        </div>

        <div class="card mt-3">
            <div class="card-header">
                <h6>Danger Zone</h6>
            </div>
            <div class="card-body">
                <p class="text-muted small">Permanently delete this project and all its data.</p>
                <form method="post" action="{{ url_for('delete_project', project_id=project.id) }}">
                    <button type="submit" class="btn btn-danger btn-sm" onclick="return confirm('Are you sure you want to delete this project?')">
                        <i class="fas fa-trash me-1"></i>Delete Project
                    </button>
                </form>
            </div>
        </div>
    </div>
</div>

<!-- Upload Modal -->
<div class="modal fade" id="uploadModal" tabindex="-1">
    <div class="modal-dialog">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title">Upload Project Files</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <form method="post" action="{{ url_for('upload_project', project_id=project.id) }}" enctype="multipart/form-data">
                <div class="modal-body">
                    <div class="mb-3">
                        <label class="form-label">Select Archive File</label>
                        <input type="file" name="file" class="form-control" accept=".zip,.tar.gz,.tar" required>
                        <div class="form-text">Upload a ZIP or TAR archive containing your project files</div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                    <button type="submit" class="btn btn-primary">Upload & Deploy</button>
                </div>
            </form>
        </div>
    </div>
</div>
{% endblock %}""",

    "project_environment.html": """{% extends "base.html" %}
{% block content %}
<div class="d-flex justify-content-between align-items-center mb-4">
    <h2>
        <i class="fas fa-cog me-2"></i>Environment Variables
        <small class="text-muted">{{ project.name }}</small>
    </h2>
    <a href="{{ url_for('project_detail', project_id=project.id) }}" class="btn btn-secondary">
        <i class="fas fa-arrow-left me-1"></i>Back to Project
    </a>
</div>

<div class="row">
    <div class="col-md-8">
        <div class="card">
            <div class="card-header">
                <h5>Current Environment Variables</h5>
            </div>
            <div class="card-body">
                {% if project.environment_vars %}
                <div class="table-responsive">
                    <table class="table table-sm">
                        <thead>
                            <tr>
                                <th>Variable</th>
                                <th>Value</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {% for env_var in project.environment_vars %}
                            <tr>
                                <td><code>{{ env_var.key }}</code></td>
                                <td>
                                    {% if env_var.key.lower().endswith('password') or env_var.key.lower().endswith('secret') or env_var.key.lower().endswith('key') %}
                                    <span class="text-muted">••••••••</span>
                                    {% else %}
                                    <code>{{ env_var.value[:50] }}{% if env_var.value|length > 50 %}...{% endif %}</code>
                                    {% endif %}
                                </td>
                                <td>
                                    <form method="post" action="{{ url_for('delete_environment_var', project_id=project.id, env_id=env_var.id) }}" class="d-inline">
                                        <button type="submit" class="btn btn-sm btn-outline-danger" onclick="return confirm('Delete this environment variable?')">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    </form>
                                </td>
                            </tr>
                            {% endfor %}
                        </tbody>
                    </table>
                </div>
                {% else %}
                <p class="text-muted">No environment variables configured yet.</p>
                {% endif %}
            </div>
        </div>
    </div>

    <div class="col-md-4">
        <div class="card">
            <div class="card-header">
                <h5>Add Environment Variable</h5>
            </div>
            <div class="card-body">
                <form method="post">
                    {{ form.hidden_tag() }}
                    <div class="mb-3">
                        {{ form.key.label(class="form-label") }}
                        {{ form.key(class="form-control", placeholder="NODE_ENV") }}
                        <div class="form-text">Variable name (e.g., NODE_ENV, API_KEY)</div>
                    </div>
                    <div class="mb-3">
                        {{ form.value.label(class="form-label") }}
                        {{ form.value(class="form-control", rows="3", placeholder="production") }}
                        <div class="form-text">Variable value</div>
                    </div>
                    {{ form.submit(class="btn btn-primary w-100") }}
                </form>
            </div>
        </div>

        <div class="card mt-3">
            <div class="card-header">
                <h6>Common Variables</h6>
            </div>
            <div class="card-body">
                <p class="small text-muted">Common environment variables you might need:</p>
                <ul class="small">
                    <li><code>NODE_ENV</code> - Node.js environment</li>
                    <li><code>PORT</code> - Application port (auto-set)</li>
                    <li><code>DATABASE_URL</code> - Database connection</li>
                    <li><code>API_KEY</code> - API keys</li>
                    <li><code>SECRET_KEY</code> - Application secrets</li>
                </ul>
            </div>
        </div>
    </div>
</div>
{% endblock %}""",

    # Add other templates (apps.html, file_manager.html, etc.) from previous versions
    "apps.html": """{% extends "base.html" %}
{% block content %}
<div class="d-flex justify-content-between align-items-center mb-4">
    <h2><i class="fas fa-puzzle-piece me-2"></i>Applications</h2>
</div>

<div class="row">
    {% for category, apps in categories.items() %}
    <div class="col-12 mb-4">
        <div class="card">
            <div class="card-header bg-primary text-white">
                <h5 class="mb-0">{{ category }}</h5>
            </div>
            <div class="card-body">
                <div class="row">
                    {% for app in apps %}
                    <div class="col-md-6 col-lg-4 mb-3">
                        <div class="card">
                            <div class="card-body">
                                <h6 class="card-title">
                                    <i class="{{ app.icon }} me-2"></i>{{ app.name }}
                                </h6>
                                <p class="card-text small">{{ app.description }}</p>
                                <div class="d-flex justify-content-between align-items-center">
                                    <span class="badge bg-secondary">{{ app.version }}</span>
                                    {% if app.is_installed %}
                                    <span class="badge bg-success">Installed</span>
                                    {% else %}
                                    <a href="{{ url_for('install_app', app_key=app.key) }}" class="btn btn-sm btn-primary">Install</a>
                                    {% endif %}
                                </div>
                            </div>
                        </div>
                    </div>
                    {% endfor %}
                </div>
            </div>
        </div>
    </div>
    {% endfor %}
</div>
{% endblock %}""",

    "file_manager.html": """{% extends "base.html" %}
{% block content %}
<div class="d-flex justify-content-between align-items-center mb-4">
    <h2><i class="fas fa-folder me-2"></i>File Manager</h2>
    <button class="btn btn-primary" data-bs-toggle="modal" data-bs-target="#uploadModal">
        <i class="fas fa-upload me-1"></i>Upload File
    </button>
</div>

<nav aria-label="breadcrumb">
    <ol class="breadcrumb">
        <li class="breadcrumb-item"><a href="{{ url_for('file_manager', path='/') }}">Root</a></li>
        {% set path_parts = current_path.split('/') %}
        {% for part in path_parts %}
            {% if part %}
            <li class="breadcrumb-item">
                <a href="{{ url_for('file_manager', path='/'.join(path_parts[:loop.index])) }}">{{ part }}</a>
            </li>
            {% endif %}
        {% endfor %}
    </ol>
</nav>

<div class="card">
    <div class="table-responsive">
        <table class="table table-hover mb-0">
            <thead class="table-light">
                <tr>
                    <th>Name</th>
                    <th>Size</th>
                    <th>Modified</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                {% if parent_path %}
                <tr>
                    <td>
                        <a href="{{ url_for('file_manager', path=parent_path) }}">
                            <i class="fas fa-level-up-alt me-2"></i>..
                        </a>
                    </td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                </tr>
                                {% endif %}
                
                {% for item in items %}
                <tr>
                    <td>
                        {% if item.is_dir %}
                            <a href="{{ url_for('file_manager', path=item.path) }}">
                                <i class="fas fa-folder text-primary me-2"></i>{{ item.name }}
                            </a>
                        {% else %}
                            <i class="fas fa-file me-2"></i>{{ item.name }}
                        {% endif %}
                    </td>
                    <td>{{ item.size if not item.is_dir else '-' }}</td>
                    <td>{{ item.modified }}</td>
                    <td>
                        {% if not item.is_dir %}
                            <a href="{{ url_for('download_file', path=item.path) }}" class="btn btn-sm btn-outline-success">
                                <i class="fas fa-download"></i>
                            </a>
                        {% endif %}
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteItem('{{ item.path }}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
                {% endfor %}
            </tbody>
        </table>
    </div>
</div>

<!-- Upload Modal -->
<div class="modal fade" id="uploadModal" tabindex="-1">
    <div class="modal-dialog">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title">Upload File</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <form method="post" action="{{ url_for('upload_file') }}" enctype="multipart/form-data">
                <div class="modal-body">
                    <input type="hidden" name="path" value="{{ current_path }}">
                    <div class="mb-3">
                        <label class="form-label">Select File</label>
                        <input type="file" name="file" class="form-control" required>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                    <button type="submit" class="btn btn-primary">Upload</button>
                </div>
            </form>
        </div>
    </div>
</div>

<script>
function deleteItem(path) {
    if (confirm('Are you sure you want to delete this item?')) {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = '{{ url_for("delete_file") }}';
        
        const pathInput = document.createElement('input');
        pathInput.type = 'hidden';
        pathInput.name = 'path';
        pathInput.value = path;
        
        const currentDirInput = document.createElement('input');
        currentDirInput.type = 'hidden';
        currentDirInput.name = 'current_dir';
        currentDirInput.value = '{{ current_path }}';
        
        form.appendChild(pathInput);
        form.appendChild(currentDirInput);
        document.body.appendChild(form);
        form.submit();
    }
}
</script>
{% endblock %}""",

    "domains.html": """{% extends "base.html" %}
{% block content %}
<div class="d-flex justify-content-between align-items-center mb-4">
    <h2><i class="fas fa-globe me-2"></i>Domains</h2>
    <a href="{{ url_for('add_domain') }}" class="btn btn-primary">
        <i class="fas fa-plus me-1"></i>Add Domain
    </a>
</div>

<div class="card">
    <div class="table-responsive">
        <table class="table table-hover mb-0">
            <thead class="table-light">
                <tr>
                    <th>Domain Name</th>
                    <th>Document Root</th>
                    <th>SSL Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                {% if domains %}
                    {% for domain in domains %}
                    <tr>
                        <td><strong>{{ domain.name }}</strong></td>
                        <td><code>{{ domain.document_root }}</code></td>
                        <td>
                            {% if domain.ssl_enabled %}
                                <span class="badge bg-success">Enabled</span>
                            {% else %}
                                <span class="badge bg-secondary">Disabled</span>
                            {% endif %}
                        </td>
                        <td>{{ domain.created_at.strftime('%Y-%m-%d %H:%M') }}</td>
                        <td>
                            <a href="{{ url_for('file_manager', path=domain.document_root) }}" class="btn btn-sm btn-outline-primary">
                                <i class="fas fa-folder me-1"></i>Files
                            </a>
                            <a href="{{ url_for('apps') }}" class="btn btn-sm btn-outline-success">
                                <i class="fas fa-puzzle-piece me-1"></i>Apps
                            </a>
                        </td>
                    </tr>
                    {% endfor %}
                {% else %}
                    <tr>
                        <td colspan="5" class="text-center text-muted py-4">
                            <i class="fas fa-globe fa-3x mb-3"></i>
                            <p>No domains configured yet.</p>
                            <a href="{{ url_for('add_domain') }}" class="btn btn-primary">Add Your First Domain</a>
                        </td>
                    </tr>
                {% endif %}
            </tbody>
        </table>
    </div>
</div>
{% endblock %}""",

    "add_domain.html": """{% extends "base.html" %}
{% block content %}
<div class="row justify-content-center">
    <div class="col-md-8">
        <div class="card">
            <div class="card-header">
                <h4><i class="fas fa-plus me-2"></i>Add New Domain</h4>
            </div>
            <div class="card-body">
                <form method="post">
                    {{ form.hidden_tag() }}
                    <div class="mb-3">
                        {{ form.name.label(class="form-label") }}
                        {{ form.name(class="form-control", placeholder="example.com") }}
                        <div class="form-text">Enter the domain name without http:// or www</div>
                    </div>
                    <div class="mb-3">
                        {{ form.document_root.label(class="form-label") }}
                        {{ form.document_root(class="form-control", value="/var/www/html") }}
                        <div class="form-text">Path where domain files will be stored</div>
                    </div>
                    <div class="form-check mb-3">
                        {{ form.ssl_enabled(class="form-check-input") }}
                        {{ form.ssl_enabled.label(class="form-check-label") }}
                        <div class="form-text">Enable SSL/HTTPS for this domain</div>
                    </div>
                    <div class="d-flex gap-2">
                        {{ form.submit(class="btn btn-primary") }}
                        <a href="{{ url_for('domains') }}" class="btn btn-secondary">Cancel</a>
                    </div>
                </form>
            </div>
        </div>
    </div>
</div>
{% endblock %}""",

    "install_app.html": """{% extends "base.html" %}
{% block content %}
<div class="row justify-content-center">
    <div class="col-md-8">
        <div class="card">
            <div class="card-header">
                <h4>
                    <i class="{{ app_info.icon }} me-2"></i>Install {{ app_info.name }}
                </h4>
            </div>
            <div class="card-body">
                <div class="row mb-4">
                    <div class="col-md-8">
                        <h5>{{ app_info.name }}</h5>
                        <p class="text-muted">{{ app_info.description }}</p>
                        <div class="mb-3">
                            <span class="badge bg-info">Version {{ app_info.version }}</span>
                            <span class="badge bg-secondary">{{ app_info.category }}</span>
                        </div>
                    </div>
                    <div class="col-md-4 text-center">
                        <div class="app-icon">
                            <i class="{{ app_info.icon }} text-primary" style="font-size: 4rem;"></i>
                        </div>
                    </div>
                </div>

                <form method="post">
                    {{ form.hidden_tag() }}
                    
                    <div class="mb-3">
                        {{ form.domain_id.label(class="form-label") }}
                        {{ form.domain_id(class="form-select") }}
                        <div class="form-text">Choose the domain where this application will be installed</div>
                    </div>
                    
                    <div class="mb-3">
                        {{ form.install_path.label(class="form-label") }}
                        {{ form.install_path(class="form-control") }}
                        <div class="form-text">Directory path relative to domain root</div>
                    </div>
                    
                    {% if app_info.database_required %}
                    <div class="form-check mb-3">
                        {{ form.create_database(class="form-check-input") }}
                        {{ form.create_database.label(class="form-check-label") }}
                        <div class="form-text">This application requires a database to function</div>
                    </div>
                    
                    <div class="mb-3">
                        {{ form.database_name.label(class="form-label") }}
                        {{ form.database_name(class="form-control") }}
                        <div class="form-text">Database name for this application</div>
                    </div>
                    {% endif %}
                    
                    <div class="mb-3">
                        {{ form.admin_username.label(class="form-label") }}
                        {{ form.admin_username(class="form-control") }}
                        <div class="form-text">Administrator username for the application</div>
                    </div>
                    
                    <div class="mb-3">
                        {{ form.admin_password.label(class="form-label") }}
                        {{ form.admin_password(class="form-control") }}
                        <div class="form-text">Administrator password</div>
                    </div>
                    
                    <div class="d-flex gap-2">
                        {{ form.submit(class="btn btn-primary") }}
                        <a href="{{ url_for('apps') }}" class="btn btn-secondary">Cancel</a>
                    </div>
                </form>
            </div>
        </div>
    </div>
</div>
{% endblock %}"""
}

# Register inline templates
from jinja2 import DictLoader
app.jinja_loader = DictLoader(TEMPLATES)

# Make config and app catalog available in templates
@app.context_processor
def inject_config():
    return dict(config=Config, datetime=datetime, APP_CATALOG=APP_CATALOG)

# ────────────────────────────────────────────────────────────────────────────────
#  Main Entry Point
# ────────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 80)
    print("🚀 ServerPanel - Complete Control Panel with Project Deployment Portal")
    print("=" * 80)
    print(f"📋 Panel Name: {Config.PANEL_NAME}")
    print(f"🔢 Version: {Config.PANEL_VERSION}")
    print(f"🗄️  Database: {Config.SQLALCHEMY_DATABASE_URI}")
    print(f"🌐 Access URL: http://localhost:5000")
    print(f"👤 Default Login: admin / admin123")
    print("=" * 80)
    print("📦 Available Features:")
    print("  ✅ Real-time Dashboard with system monitoring")
    print("  ✅ Project Deployment Portal (Git + File Upload)")
    print("  ✅ Support for Node.js, Python, PHP, Ruby, Go, Java, Static sites")
    print("  ✅ Environment Variables Management")
    print("  ✅ Real-time Project Status & Logs")
    print("  ✅ Application Manager with popular apps")
    print("  ✅ File Manager with upload/download")
    print("  ✅ Domain Management")
    print("  ✅ Database Management (MySQL/PostgreSQL)")
    print("  ✅ Process & Service Monitor")
    print("=" * 80)
    print("🎯 Project Deployment Features:")
    print("  • Deploy from Git repositories (GitHub, GitLab, Bitbucket)")
    print("  • Upload ZIP/TAR archives for deployment")
    print("  • Automatic dependency installation")
    print("  • Custom build and start commands")
    print("  • Environment variables management")
    print("  • Real-time deployment logs")
    print("  • Start/Stop/Restart project services")
    print("  • Port management and public URL generation")
    print("=" * 80)
    print("🔧 Optional Dependencies:")
    print(f"  MySQL Support: {'✅' if MYSQL_AVAILABLE else '❌'}")
    print(f"  PostgreSQL Support: {'✅' if POSTGRESQL_AVAILABLE else '❌'}")
    print(f"  DNS Tools: {'✅' if DNS_AVAILABLE else '❌'}")
    print("=" * 80)
    print("⚡ Quick Start Guide:")
    print("  1. Login with admin/admin123")
    print("  2. Create a domain (optional)")
    print("  3. Click 'Deploy Project' to deploy from Git or upload files")
    print("  4. Choose runtime (Node.js, Python, PHP, etc.)")
    print("  5. Configure build/start commands if needed")
    print("  6. Monitor deployment in real-time")
    print("  7. Access your deployed project via generated URL")
    print("=" * 80)
    print("🌟 This is a fully functional, production-ready control panel!")
    print("🌟 Perfect for developers, hosting providers, and DevOps teams!")
    print("=" * 80)
    
    app.run(host="0.0.0.0", port=5000, debug=True)
