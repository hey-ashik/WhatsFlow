-- WhatsFlow Database Schema
-- Compatible with MySQL 5.7+ / 8.0+ / MariaDB and Hostinger cPanel / phpMyAdmin

CREATE TABLE IF NOT EXISTS `wf_settings` (
    `key_name` VARCHAR(100) PRIMARY KEY,
    `value_text` TEXT,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wf_sessions` (
    `session_id` VARCHAR(100) PRIMARY KEY,
    `phone_number` VARCHAR(50) NULL,
    `display_name` VARCHAR(100) NULL,
    `status` VARCHAR(50) DEFAULT 'disconnected', -- disconnected, generating_qr, scanning, connected
    `qr_code` TEXT NULL,
    `platform` VARCHAR(50) DEFAULT 'WhatsApp Web',
    `last_active` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wf_projects` (
    `id` VARCHAR(100) PRIMARY KEY,
    `name` VARCHAR(255) NOT NULL,
    `api_key` VARCHAR(255) UNIQUE NOT NULL,
    `webhook_url` TEXT NULL,
    `is_active` TINYINT DEFAULT 1,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wf_automations` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(255) NOT NULL,
    `trigger_type` VARCHAR(50) NOT NULL, -- exact, contains, starts_with, regex, default, flow
    `trigger_value` VARCHAR(255) NOT NULL,
    `response_type` VARCHAR(50) DEFAULT 'text', -- text, menu, webhook, flow
    `response_content` TEXT NOT NULL,
    `is_active` TINYINT DEFAULT 1,
    `execution_count` INT DEFAULT 0,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wf_contacts` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `phone` VARCHAR(50) UNIQUE NOT NULL,
    `name` VARCHAR(255) NULL,
    `current_flow` VARCHAR(100) NULL,
    `current_step` VARCHAR(100) NULL,
    `flow_data` TEXT NULL, -- JSON formatted active session state
    `total_messages` INT DEFAULT 0,
    `last_interaction` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wf_messages` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `message_id` VARCHAR(100) NULL,
    `session_id` VARCHAR(100) DEFAULT 'default',
    `from_phone` VARCHAR(50) NOT NULL,
    `to_phone` VARCHAR(50) NOT NULL,
    `direction` VARCHAR(20) NOT NULL, -- incoming, outgoing
    `message_text` TEXT NOT NULL,
    `message_type` VARCHAR(50) DEFAULT 'text',
    `automation_matched` VARCHAR(255) NULL,
    `status` VARCHAR(50) DEFAULT 'delivered', -- sent, delivered, read, failed
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wf_logs` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `level` VARCHAR(20) DEFAULT 'info', -- info, trigger, webhook, error
    `event_name` VARCHAR(100) NOT NULL,
    `details` TEXT NULL,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Default Settings and Preset Automations
INSERT INTO `wf_settings` (`key_name`, `value_text`) VALUES
('api_key', 'qb_live_9f83a82c74d6b01e289f81a7b'),
('webhook_url', ''),
('webhook_secret', ''),
('bot_enabled', '1'),
('ai_enabled', '0'),
('ai_api_key', ''),
('ai_model', 'llama-3.3-70b-versatile'),
('default_fallback_reply', 'Thank you for reaching out! Send *help* or *menu* to explore our options.')
ON DUPLICATE KEY UPDATE `key_name` = `key_name`;

-- Seed Preset Automations (QuickBite & General Assistant)
INSERT INTO `wf_automations` (`name`, `trigger_type`, `trigger_value`, `response_type`, `response_content`, `is_active`) VALUES
('Welcome & Menu', 'exact', 'hi', 'text', '👋 Hello! Welcome to *QuickBite WhatsApp Assistant*.\n\nHow can we help you today?\n\n1️⃣ *Create Restaurant Page* - Type `create`\n2️⃣ *View Food Menu* - Type `menu`\n3️⃣ *Track My Order* - Type `order`\n4️⃣ *Customer Support* - Type `help`\n\n_Reply with any number or keyword to begin!_', 1),
('Start Command', 'exact', 'start', 'text', '👋 Welcome to *QuickBite WhatsApp Bot*!\n\nSend `create` to register a new restaurant page, or send `menu` to view demo food items.', 1),
('Help & Support', 'contains', 'help', 'text', '🛎️ *QuickBite Support Center*\n\nNeed assistance? Here are the available commands:\n• `create` - Onboard your restaurant\n• `menu` - Explore food categories\n• `order` - Check live order status\n• `cancel` - Reset your active chat flow\n\nVisit our website: https://quickbite.ashiik.com', 1),
('QuickBite Restaurant Creator Flow', 'exact', 'create', 'flow', 'quickbite_onboarding', 1),
('QuickBite Restaurant Creator Alt', 'exact', 'create restaurant page', 'flow', 'quickbite_onboarding', 1),
('Food Menu Query', 'contains', 'menu', 'text', '🍔 *QuickBite Digital Menu Preview*\n\n1. 🍕 *Margherita Pizza* - $12.99\n2. 🍔 *Classic Cheeseburger* - $8.99\n3. 🥗 *Caesar Salad* - $7.49\n4. 🥤 *Craft Soda / Beverage* - $2.99\n\nTo place an order or view restaurant details, visit https://quickbite.ashiik.com', 1)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);
