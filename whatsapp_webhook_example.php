<?php
// whatsapp_bot.php
// WhatsApp Bot Webhook Handler for QuickBite Builder (WhatsFlow Integration)
// Handles restaurant creation and management via WhatsApp conversations

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/cache.php';

// ---------------------------------------------------------------
// 1. Configuration (Loaded directly from .env file via db.php)
// ---------------------------------------------------------------
$SITE_URL          = rtrim(getenv('SITE_URL') ?: ($_ENV['SITE_URL'] ?? ($_SERVER['SITE_URL'] ?? '')), '/');
$WHATSFLOW_API_URL = getenv('WHATSFLOW_API_URL') ?: ($_ENV['WHATSFLOW_API_URL'] ?? ($_SERVER['WHATSFLOW_API_URL'] ?? ''));
$WHATSFLOW_API_KEY = getenv('WHATSFLOW_API_KEY') ?: ($_ENV['WHATSFLOW_API_KEY'] ?? ($_SERVER['WHATSFLOW_API_KEY'] ?? ''));
$TUTORIAL_VIDEO_URL = getenv('TUTORIAL_VIDEO_URL') ?: ($_ENV['TUTORIAL_VIDEO_URL'] ?? ($_SERVER['TUTORIAL_VIDEO_URL'] ?? 'https://youtu.be/MTmOPFiSYtI?si=mHz7Ic3ai3LtVj_l'));

// Set JSON headers
header('Content-Type: application/json; charset=utf-8');

// ---------------------------------------------------------------
// 2. Receive Webhook Update (from WhatsFlow)
// ---------------------------------------------------------------
$rawInput = file_get_contents('php://input');
$update = json_decode($rawInput, true);

// If not JSON body, check $_POST
if (!$update && !empty($_POST)) {
    $update = $_POST;
}

// Health check / GET status ping
if ($_SERVER['REQUEST_METHOD'] === 'GET' || empty($update)) {
    echo json_encode([
        'status' => 'active',
        'service' => 'QuickBite WhatsApp Bot',
        'version' => '1.0',
        'webhook' => 'ready',
        'site_url' => $SITE_URL
    ]);
    exit;
}

// Extract sender details from WhatsFlow webhook payload
// Standard WhatsFlow format: { event, from, pushName, text, timestamp }
$rawPhone = $update['from'] ?? $update['phone'] ?? $update['sender'] ?? $update['data']['from'] ?? $update['data']['sender'] ?? '';
if (strpos($rawPhone, '@') !== false) {
    $rawPhone = explode('@', $rawPhone)[0];
}
$senderPhone = preg_replace('/[^0-9]/', '', $rawPhone);
$senderName = trim($update['pushName'] ?? $update['name'] ?? $update['data']['pushName'] ?? 'Friend');
$text = trim($update['text'] ?? $update['message'] ?? $update['body'] ?? $update['data']['text'] ?? $update['data']['message'] ?? '');

if (empty($senderPhone)) {
    echo json_encode(['status' => 'error', 'error' => 'Missing sender phone number']);
    exit;
}

// ---------------------------------------------------------------
// 3. Main WhatsApp Message Router
// ---------------------------------------------------------------
$lowerText = strtolower($text);

// Global cancel / reset commands (always reset session)
if (in_array($lowerText, ['cancel', '/cancel', 'stop', 'reset', 'clear', 'exit'])) {
    clearWhatsAppSession($senderPhone);
    $msg = "Operation cancelled.\n\n";
    $msg .= "Reply with an option:\n";
    $msg .= "1. Create restaurant page\n";
    $msg .= "2. My restaurant pages\n";
    $msg .= "3. Help";
    sendWhatsAppReply($senderPhone, $msg);
    exit;
}

// Global start & menu commands (always clear active session and show main menu)
if (in_array($lowerText, ['hi', 'hello', 'hey', 'start', '/start', 'menu', '/menu', '0', 'main menu'])) {
    clearWhatsAppSession($senderPhone);
    sendStartMenu($senderPhone, $senderName);
    exit;
}

// Global help command
if (in_array($lowerText, ['help', '/help', '3', 'help guide'])) {
    sendHelpMessage($senderPhone, $senderName);
    exit;
}

// Check active session first
$session = getWhatsAppSession($senderPhone);

if ($session && !empty($session['step'])) {
    // Active conversation step in progress
    handleConversationFlow($senderPhone, $text, $session, $senderName);
    exit;
}

// Action Routing (When not in a session)
if (
    $lowerText === '1' || 
    $lowerText === 'create' || 
    $lowerText === 'create restaurant' || 
    $lowerText === 'create restaurant page' || 
    $lowerText === '→ create restaurant page' || 
    $lowerText === '/create'
) {
    setWhatsAppSession($senderPhone, 'ask_owner_name', []);
    $msg = "Step 1 of 5: What is your full name? (Owner Name)";
    sendWhatsAppReply($senderPhone, $msg);
} elseif (
    $lowerText === '2' || 
    $lowerText === 'my restaurant pages' || 
    $lowerText === 'my restaurants' || 
    $lowerText === 'my pages' || 
    $lowerText === '✓ my restaurant pages' || 
    $lowerText === '/myrestaurants'
) {
    handleMyRestaurants($senderPhone, $senderName);
} else {
    // If text didn't match specific command, reply with start menu
    sendStartMenu($senderPhone, $senderName);
}
exit;


// ---------------------------------------------------------------
// 4. CORE FUNCTIONS
// ---------------------------------------------------------------

/**
 * Send the main start menu
 */
function sendStartMenu($phone, $senderName) {
    $name = !empty($senderName) ? $senderName : 'Friend';
    $msg = "Hi {$name},\n\n";
    $msg .= "Welcome to QuickBite Builder.\n\n";
    $msg .= "Create and manage your restaurant pages.\n\n";
    $msg .= "Reply with an option:\n";
    $msg .= "1. Create restaurant page\n";
    $msg .= "2. My restaurant pages\n";
    $msg .= "3. Help";

    sendWhatsAppReply($phone, $msg);
}

/**
 * Send help / guide message
 */
function sendHelpMessage($phone, $senderName) {
    global $TUTORIAL_VIDEO_URL;
    $name = !empty($senderName) ? $senderName : 'Friend';

    $msg = "Hi {$name},\n\n";
    $msg .= "QuickBite Builder Help\n\n";
    $msg .= "Steps to create a restaurant:\n";
    $msg .= "1. Choose 'Create restaurant page'\n";
    $msg .= "2. Provide name, email, password, restaurant name & URL\n";
    $msg .= "3. Your website & dashboard are ready instantly.\n\n";
    $msg .= "📹 Video Tutorial:\n";
    $msg .= "Watch this YouTube video to learn how to use this application:\n";
    $msg .= "{$TUTORIAL_VIDEO_URL}\n\n";
    $msg .= "Reply with an option:\n";
    $msg .= "1. Create restaurant page\n";
    $msg .= "2. My restaurant pages\n";
    $msg .= "3. Help";

    sendWhatsAppReply($phone, $msg);
}

/**
 * List all restaurant pages owned by this WhatsApp user
 */
function handleMyRestaurants($phone, $senderName) {
    global $SITE_URL, $TUTORIAL_VIDEO_URL;
    $db = getDB();

    $stmt = $db->prepare("SELECT u.id, u.name as owner_name, r.name as restaurant_name, r.slug, u.email 
                          FROM users u 
                          JOIN restaurants r ON r.owner_id = u.id 
                          WHERE u.whatsapp_phone = ? OR u.whatsapp_phone = ?
                          ORDER BY r.id DESC");
    $stmt->execute([$phone, "+{$phone}"]);
    $restaurants = $stmt->fetchAll();

    if (empty($restaurants)) {
        $msg = "Hi {$senderName},\n\n";
        $msg .= "You do not have any restaurant pages yet.\n\n";
        $msg .= "Reply with an option:\n";
        $msg .= "1. Create restaurant page\n";
        $msg .= "2. Main menu\n";
        $msg .= "3. Help";
        sendWhatsAppReply($phone, $msg);
        return;
    }

    $count = count($restaurants);
    $msg = "Your Restaurant Pages ({$count}):\n\n";

    $index = 1;
    $map = [];
    $msg .= "Reply with an option:\n";
    foreach ($restaurants as $r) {
        $msg .= "{$index}. View {$r['restaurant_name']} (Slug: {$r['slug']})\n";
        $map[(string)$index] = $r;
        $map[strtolower($r['slug'])] = $r;
        $index++;
    }

    $createOptionIndex = (string)$index;
    $menuOptionIndex = (string)($index + 1);

    $msg .= "{$createOptionIndex}. Create new restaurant\n";
    $msg .= "{$menuOptionIndex}. Main menu";

    $sessionPayload = [
        'restaurants' => $restaurants,
        'map' => $map,
        'create_index' => $createOptionIndex,
        'menu_index' => $menuOptionIndex
    ];

    setWhatsAppSession($phone, 'view_restaurant_selection', $sessionPayload);
    sendWhatsAppReply($phone, $msg);
}

/**
 * Handle Step-by-Step Restaurant Creation Conversation Flow
 */
function handleConversationFlow($phone, $text, $session, $senderName) {
    global $SITE_URL, $TUTORIAL_VIDEO_URL;
    $step = $session['step'];
    $sessionData = $session['data'] ?? [];
    $trimmedText = trim($text);
    $lowerText = strtolower($trimmedText);

    // Restaurant details selection handler
    if ($step === 'view_restaurant_selection') {
        $map = $sessionData['map'] ?? [];
        $createIndex = $sessionData['create_index'] ?? '';
        $menuIndex = $sessionData['menu_index'] ?? '';

        if (
            $lowerText === 'create' || 
            $lowerText === 'new' || 
            $lowerText === 'create restaurant' || 
            $lowerText === 'create restaurant page' || 
            $lowerText === '/create' ||
            ($createIndex !== '' && $lowerText === strtolower($createIndex))
        ) {
            setWhatsAppSession($phone, 'ask_owner_name', []);
            sendWhatsAppReply($phone, "Step 1 of 5: What is your full name? (Owner Name)");
            return;
        }

        if (
            $lowerText === 'menu' || 
            $lowerText === '/menu' || 
            $lowerText === 'main menu' || 
            $lowerText === '0' ||
            ($menuIndex !== '' && $lowerText === strtolower($menuIndex))
        ) {
            clearWhatsAppSession($phone);
            sendStartMenu($phone, $senderName);
            return;
        }

        if ($lowerText === 'my restaurant pages' || $lowerText === 'my restaurants' || $lowerText === 'my pages') {
            handleMyRestaurants($phone, $senderName);
            return;
        }

        $selected = null;
        if (isset($map[$trimmedText])) {
            $selected = $map[$trimmedText];
        } elseif (isset($map[$lowerText])) {
            $selected = $map[$lowerText];
        }

        if ($selected) {
            clearWhatsAppSession($phone);
            $msg = "🏢 {$selected['restaurant_name']}\n\n";
            $msg .= "🌐 Website:\n{$SITE_URL}/{$selected['slug']}\n\n";
            $msg .= "📊 Dashboard:\n{$SITE_URL}/login\n\n";
            $msg .= "✉️ Login Email:\n{$selected['email']}\n\n";
            $msg .= "📹 Video Tutorial:\n";
            $msg .= "Watch this YouTube video to learn how to use this application:\n";
            $msg .= "{$TUTORIAL_VIDEO_URL}\n\n";
            $msg .= "Reply with an option:\n";
            $msg .= "1. Create another restaurant\n";
            $msg .= "2. My restaurant pages\n";
            $msg .= "3. Help";
            sendWhatsAppReply($phone, $msg);
            return;
        }

        // Unrecognized selection, re-prompt with clean list
        $count = count($sessionData['restaurants'] ?? []);
        $msg = "Please reply with a valid option number (1-{$count}) or 'menu' for main menu.";
        sendWhatsAppReply($phone, $msg);
        return;
    }

    switch ($step) {
        case 'ask_owner_name':
            if (strlen($trimmedText) < 2 || strlen($trimmedText) > 100) {
                sendWhatsAppReply($phone, "Please enter a valid name (2-100 characters):");
                return;
            }
            $sessionData['owner_name'] = $trimmedText;
            setWhatsAppSession($phone, 'ask_email', $sessionData);
            sendWhatsAppReply($phone, "Step 2 of 5: Enter your email address (used for dashboard login):");
            break;

        case 'ask_email':
            if (!filter_var($trimmedText, FILTER_VALIDATE_EMAIL)) {
                sendWhatsAppReply($phone, "Invalid email format. Please enter a valid email address:");
                return;
            }

            try {
                $db = getDB();
                $stmt = $db->prepare("SELECT id, role FROM users WHERE email = ?");
                $stmt->execute([strtolower($trimmedText)]);
                $existingUser = $stmt->fetch();

                if ($existingUser) {
                    $sessionData['existing_user_id'] = $existingUser['id'];
                }
            } catch (Exception $e) {
                // Continue if DB lookup encounters an issue
            }

            $sessionData['email'] = strtolower($trimmedText);
            setWhatsAppSession($phone, 'ask_password', $sessionData);
            sendWhatsAppReply($phone, "Step 3 of 5: Create a password (minimum 6 characters):");
            break;

        case 'ask_password':
            if (strlen($trimmedText) < 6) {
                sendWhatsAppReply($phone, "Password must be at least 6 characters. Please try again:");
                return;
            }
            $sessionData['password'] = $trimmedText;
            setWhatsAppSession($phone, 'ask_restaurant_name', $sessionData);
            sendWhatsAppReply($phone, "Step 4 of 5: Enter your restaurant name:");
            break;

        case 'ask_restaurant_name':
            if (strlen($trimmedText) < 2 || strlen($trimmedText) > 200) {
                sendWhatsAppReply($phone, "Restaurant name must be 2-200 characters. Please try again:");
                return;
            }
            $sessionData['restaurant_name'] = $trimmedText;

            // Auto-generate suggested slug
            $suggestedSlug = strtolower(preg_replace('/[^a-zA-Z0-9]+/', '-', $trimmedText));
            $suggestedSlug = trim($suggestedSlug, '-');
            if (empty($suggestedSlug)) {
                $suggestedSlug = 'restaurant-' . rand(100, 999);
            }
            $sessionData['suggested_slug'] = $suggestedSlug;

            setWhatsAppSession($phone, 'ask_restaurant_url', $sessionData);
            $msg = "Step 5 of 5: Choose your restaurant URL slug:\n\n";
            $msg .= "Example:\n{$SITE_URL}/{$suggestedSlug}\n\n";
            $msg .= "Suggested slug: {$suggestedSlug}\n\n";
            $msg .= "Reply with an option:\n";
            $msg .= "1. Use suggested slug ({$suggestedSlug})\n";
            $msg .= "2. Type your own custom slug";
            sendWhatsAppReply($phone, $msg);
            break;

        case 'ask_restaurant_url':
            // If user selects Option 2 (Type custom slug)
            if ($trimmedText === '2' || $lowerText === 'custom' || $lowerText === 'type' || $lowerText === 'own' || $lowerText === 'type your own custom slug') {
                setWhatsAppSession($phone, 'ask_custom_slug', $sessionData);
                $msg = "Enter your preferred URL slug (letters, numbers, hyphens):\n\n";
                $msg .= "Example: my-restaurant";
                sendWhatsAppReply($phone, $msg);
                return;
            }

            // If user selects Option 1 (Use suggested slug)
            if ($trimmedText === '1' || $lowerText === 'suggested' || $lowerText === 'use suggested') {
                $slug = $sessionData['suggested_slug'] ?? 'restaurant-' . rand(100, 999);
            } else {
                // User directly typed a custom slug
                $slug = strtolower(preg_replace('/[^a-zA-Z0-9-]/', '-', $trimmedText));
                $slug = preg_replace('/-+/', '-', $slug);
                $slug = trim($slug, '-');
            }

            if (strlen($slug) < 2 || strlen($slug) > 100) {
                sendWhatsAppReply($phone, "URL slug must be 2-100 characters. Please try again:");
                return;
            }

            // Check if slug already exists
            try {
                $db = getDB();
                $stmt = $db->prepare("SELECT id FROM restaurants WHERE slug = ?");
                $stmt->execute([$slug]);
                if ($stmt->fetch()) {
                    $alt1 = $slug . '-' . rand(10, 99);
                    $alt2 = $slug . '-' . substr(uniqid(), -4);
                    $sessionData['alt1'] = $alt1;
                    $sessionData['alt2'] = $alt2;
                    setWhatsAppSession($phone, 'ask_restaurant_url_taken', $sessionData);

                    $msg = "The URL slug '{$slug}' is already taken.\n\n";
                    $msg .= "Reply with an option:\n";
                    $msg .= "1. Use {$alt1}\n";
                    $msg .= "2. Use {$alt2}\n";
                    $msg .= "3. Type a different custom slug";
                    sendWhatsAppReply($phone, $msg);
                    return;
                }
            } catch (Exception $e) {
                // Continue if table check encounters an issue
            }

            $sessionData['slug'] = $slug;
            setWhatsAppSession($phone, 'confirm_creation', $sessionData);

            $msg = "Review your restaurant details:\n\n";
            $msg .= "Owner Name: {$sessionData['owner_name']}\n";
            $msg .= "Email: {$sessionData['email']}\n";
            $msg .= "Restaurant Name: {$sessionData['restaurant_name']}\n";
            $msg .= "Website: {$SITE_URL}/{$slug}\n\n";
            $msg .= "Reply with an option:\n";
            $msg .= "1. Confirm & Create\n";
            $msg .= "2. Cancel";

            sendWhatsAppReply($phone, $msg);
            break;

        case 'ask_custom_slug':
            $slug = strtolower(preg_replace('/[^a-zA-Z0-9-]/', '-', $trimmedText));
            $slug = preg_replace('/-+/', '-', $slug);
            $slug = trim($slug, '-');

            if (strlen($slug) < 2 || strlen($slug) > 100) {
                sendWhatsAppReply($phone, "URL slug must be 2-100 characters. Please enter a valid URL slug:");
                return;
            }

            // Check if slug already exists
            try {
                $db = getDB();
                $stmt = $db->prepare("SELECT id FROM restaurants WHERE slug = ?");
                $stmt->execute([$slug]);
                if ($stmt->fetch()) {
                    $alt1 = $slug . '-' . rand(10, 99);
                    $alt2 = $slug . '-' . substr(uniqid(), -4);
                    $sessionData['alt1'] = $alt1;
                    $sessionData['alt2'] = $alt2;
                    setWhatsAppSession($phone, 'ask_restaurant_url_taken', $sessionData);

                    $msg = "The URL slug '{$slug}' is already taken.\n\n";
                    $msg .= "Reply with an option:\n";
                    $msg .= "1. Use {$alt1}\n";
                    $msg .= "2. Use {$alt2}\n";
                    $msg .= "3. Type a different custom slug";
                    sendWhatsAppReply($phone, $msg);
                    return;
                }
            } catch (Exception $e) {
                // Continue if check error
            }

            $sessionData['slug'] = $slug;
            setWhatsAppSession($phone, 'confirm_creation', $sessionData);

            $msg = "Review your restaurant details:\n\n";
            $msg .= "Owner Name: {$sessionData['owner_name']}\n";
            $msg .= "Email: {$sessionData['email']}\n";
            $msg .= "Restaurant Name: {$sessionData['restaurant_name']}\n";
            $msg .= "Website: {$SITE_URL}/{$slug}\n\n";
            $msg .= "Reply with an option:\n";
            $msg .= "1. Confirm & Create\n";
            $msg .= "2. Cancel";

            sendWhatsAppReply($phone, $msg);
            break;

        case 'ask_restaurant_url_taken':
            $alt1 = $sessionData['alt1'] ?? '';
            $alt2 = $sessionData['alt2'] ?? '';

            if ($trimmedText === '1' && !empty($alt1)) {
                $slug = $alt1;
            } elseif ($trimmedText === '2' && !empty($alt2)) {
                $slug = $alt2;
            } elseif ($trimmedText === '3' || $lowerText === 'type' || $lowerText === 'custom' || $lowerText === 'different') {
                setWhatsAppSession($phone, 'ask_custom_slug', $sessionData);
                $msg = "Enter your preferred URL slug (letters, numbers, hyphens):\n\n";
                $msg .= "Example: my-restaurant";
                sendWhatsAppReply($phone, $msg);
                return;
            } else {
                $slug = strtolower(preg_replace('/[^a-zA-Z0-9-]/', '-', $trimmedText));
                $slug = preg_replace('/-+/', '-', $slug);
                $slug = trim($slug, '-');
            }

            if (strlen($slug) < 2 || strlen($slug) > 100) {
                sendWhatsAppReply($phone, "URL slug must be 2-100 characters. Please try again:");
                return;
            }

            // Check if chosen slug is also taken
            try {
                $db = getDB();
                $stmt = $db->prepare("SELECT id FROM restaurants WHERE slug = ?");
                $stmt->execute([$slug]);
                if ($stmt->fetch()) {
                    $alt1 = $slug . '-' . rand(10, 99);
                    $alt2 = $slug . '-' . substr(uniqid(), -4);
                    $sessionData['alt1'] = $alt1;
                    $sessionData['alt2'] = $alt2;
                    setWhatsAppSession($phone, 'ask_restaurant_url_taken', $sessionData);

                    $msg = "The URL slug '{$slug}' is already taken.\n\n";
                    $msg .= "Reply with an option:\n";
                    $msg .= "1. Use {$alt1}\n";
                    $msg .= "2. Use {$alt2}\n";
                    $msg .= "3. Type a different custom slug";
                    sendWhatsAppReply($phone, $msg);
                    return;
                }
            } catch (Exception $e) {}

            $sessionData['slug'] = $slug;
            setWhatsAppSession($phone, 'confirm_creation', $sessionData);

            $msg = "Review your restaurant details:\n\n";
            $msg .= "Owner Name: {$sessionData['owner_name']}\n";
            $msg .= "Email: {$sessionData['email']}\n";
            $msg .= "Restaurant Name: {$sessionData['restaurant_name']}\n";
            $msg .= "Website: {$SITE_URL}/{$slug}\n\n";
            $msg .= "Reply with an option:\n";
            $msg .= "1. Confirm & Create\n";
            $msg .= "2. Cancel";

            sendWhatsAppReply($phone, $msg);
            break;

        case 'confirm_creation':
            if ($lowerText === '1' || $lowerText === 'yes' || $lowerText === 'y' || $lowerText === 'confirm' || $lowerText === 'ok' || $lowerText === 'create') {
                handleRestaurantCreation($phone, $sessionData);
            } elseif ($lowerText === '2' || $lowerText === 'cancel' || $lowerText === 'no' || $lowerText === 'stop') {
                clearWhatsAppSession($phone);
                $msg = "Restaurant creation cancelled.\n\n";
                $msg .= "Reply with an option:\n";
                $msg .= "1. Create restaurant page\n";
                $msg .= "2. My restaurant pages\n";
                $msg .= "3. Help";
                sendWhatsAppReply($phone, $msg);
            } else {
                $msg = "Please reply with an option:\n";
                $msg .= "1. Confirm & Create\n";
                $msg .= "2. Cancel";
                sendWhatsAppReply($phone, $msg);
            }
            break;

        default:
            sendStartMenu($phone, $senderName);
            break;
    }
}

/**
 * Create the restaurant in the database after confirmation
 */
function handleRestaurantCreation($phone, $data) {
    global $SITE_URL, $TUTORIAL_VIDEO_URL;
    $db = getDB();

    $ownerName = $data['owner_name'] ?? '';
    $email = $data['email'] ?? '';
    $password = $data['password'] ?? '';
    $restaurantName = $data['restaurant_name'] ?? '';
    $slug = $data['slug'] ?? '';

    if (empty($ownerName) || empty($email) || empty($password) || empty($restaurantName) || empty($slug)) {
        clearWhatsAppSession($phone);
        $msg = "Session expired or missing fields.\n\n";
        $msg .= "Reply with an option:\n";
        $msg .= "1. Create restaurant page\n";
        $msg .= "2. My restaurant pages\n";
        $msg .= "3. Help";
        sendWhatsAppReply($phone, $msg);
        return;
    }

    try {
        $db->beginTransaction();

        $userId = null;

        if (isset($data['existing_user_id'])) {
            $userId = $data['existing_user_id'];
            $hashedPassword = password_hash($password, PASSWORD_DEFAULT);
            $stmt = $db->prepare("UPDATE users SET name = ?, password = ?, role = 'owner', whatsapp_phone = ?, is_verified = 1 WHERE id = ?");
            $stmt->execute([$ownerName, $hashedPassword, $phone, $userId]);
        } else {
            $hashedPassword = password_hash($password, PASSWORD_DEFAULT);
            $stmt = $db->prepare("INSERT INTO users (name, email, password, role, whatsapp_phone, is_verified) VALUES (?, ?, ?, 'owner', ?, 1)");
            $stmt->execute([$ownerName, $email, $hashedPassword, $phone]);
            $userId = $db->lastInsertId();
        }

        // Double-check slug uniqueness
        $slugCheck = $db->prepare("SELECT id FROM restaurants WHERE slug = ?");
        $slugCheck->execute([$slug]);
        if ($slugCheck->fetch()) {
            $slug = $slug . '-' . substr(uniqid(), -5);
        }

        // Create restaurant
        $stmt = $db->prepare("INSERT INTO restaurants (owner_id, name, slug) VALUES (?, ?, ?)");
        $stmt->execute([$userId, $restaurantName, $slug]);

        $db->commit();

        // Clear website cache so new restaurant appears instantly
        Cache::clear();

        // Clear the conversation session
        clearWhatsAppSession($phone);

        // Build clean success message
        $msg = "🎉 Your restaurant is ready!\n\n";
        $msg .= "🌐 Your Restaurant Website:\n";
        $msg .= "{$SITE_URL}/{$slug}\n\n";
        $msg .= "Restaurant Name:\n";
        $msg .= "{$restaurantName}\n\n";
        $msg .= "Login credentials:\n";
        $msg .= "Email: {$email}\n";
        $msg .= "Password: The password you created\n\n";
        $msg .= "🔐 Dashboard:\n";
        $msg .= "{$SITE_URL}/login\n\n";
        $msg .= "📹 How to use this application:\n";
        $msg .= "Watch this YouTube video to learn how to use this application:\n";
        $msg .= "{$TUTORIAL_VIDEO_URL}\n\n";
        $msg .= "Reply with an option:\n";
        $msg .= "1. Create another restaurant\n";
        $msg .= "2. My restaurant pages\n";
        $msg .= "3. Help";

        sendWhatsAppReply($phone, $msg);

    } catch (PDOException $e) {
        $db->rollBack();

        if ($e->getCode() == 23000 || strpos($e->getMessage(), 'Duplicate') !== false) {
            $msg = "This email is already registered.\n\n";
            $msg .= "Reply with an option:\n";
            $msg .= "1. Try creating with a different email\n";
            $msg .= "2. My restaurant pages\n";
            $msg .= "3. Main menu";
            sendWhatsAppReply($phone, $msg);
        } else {
            $msg = "An error occurred while creating your restaurant.\n\n";
            $msg .= "Reply with an option:\n";
            $msg .= "1. Try again\n";
            $msg .= "2. Main menu\n";
            $msg .= "3. Help";
            sendWhatsAppReply($phone, $msg);
        }

        clearWhatsAppSession($phone);
    }
}


// ---------------------------------------------------------------
// 5. SESSION MANAGEMENT (Database-backed conversation state)
// ---------------------------------------------------------------

/**
 * Ensure the whatsapp_sessions table exists
 */
function ensureWhatsAppSessionTable() {
    $db = getDB();
    try {
        $db->exec("
            CREATE TABLE IF NOT EXISTS `whatsapp_sessions` (
                `phone` VARCHAR(50) PRIMARY KEY,
                `step` VARCHAR(100) NOT NULL,
                `data` LONGTEXT NULL,
                `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        ");
    } catch (Exception $e) {
        // Table already exists
    }
}

/**
 * Get active session for a WhatsApp phone number
 */
function getWhatsAppSession($phone) {
    try {
        ensureWhatsAppSessionTable();
        $db = getDB();
        $stmt = $db->prepare("SELECT step, data FROM whatsapp_sessions WHERE phone = ?");
        $stmt->execute([$phone]);
        $row = $stmt->fetch();
        if ($row) {
            return [
                'step' => $row['step'],
                'data' => json_decode($row['data'], true) ?: []
            ];
        }
    } catch (Exception $e) {
        // Fallback gracefully on DB error
    }
    return null;
}

/**
 * Set or update session for a WhatsApp phone number
 */
function setWhatsAppSession($phone, $step, $data = []) {
    try {
        ensureWhatsAppSessionTable();
        $db = getDB();
        $jsonData = json_encode($data);
        $stmt = $db->prepare("
            INSERT INTO whatsapp_sessions (phone, step, data) VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE step = VALUES(step), data = VALUES(data), updated_at = NOW()
        ");
        $stmt->execute([$phone, $step, $jsonData]);
    } catch (Exception $e) {
        // Log or handle DB error
    }
}

/**
 * Clear session for a WhatsApp phone number
 */
function clearWhatsAppSession($phone) {
    try {
        ensureWhatsAppSessionTable();
        $db = getDB();
        $stmt = $db->prepare("DELETE FROM whatsapp_sessions WHERE phone = ?");
        $stmt->execute([$phone]);
    } catch (Exception $e) {
        // Ignore deletion errors
    }
}


// ---------------------------------------------------------------
// 6. WHATSFLOW API & WEBHOOK DISPATCH HELPERS
// ---------------------------------------------------------------

/**
 * Output webhook JSON response for WhatsFlow immediate delivery
 */
function sendWhatsAppReply($phone, $message) {
    echo json_encode([
        'status' => 'success',
        'to' => $phone,
        'reply' => $message,
        'message' => $message,
        'text' => $message
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

/**
 * Send an outbound message to any WhatsApp number via WhatsFlow API Gateway
 * (Used for async notifications, background alerts, and standalone messaging)
 */
function sendWhatsAppMessage($toPhone, $message) {
    global $WHATSFLOW_API_URL, $WHATSFLOW_API_KEY;

    if (empty($WHATSFLOW_API_URL) || empty($WHATSFLOW_API_KEY)) {
        return ['success' => false, 'error' => 'WHATSFLOW_API_URL or WHATSFLOW_API_KEY is not configured in .env'];
    }

    $cleanPhone = preg_replace('/[^0-9]/', '', $toPhone);
    $payload = json_encode([
        'to' => $cleanPhone,
        'message' => $message
    ]);

    $ch = curl_init($WHATSFLOW_API_URL);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . $WHATSFLOW_API_KEY
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => false
    ]);

    $response = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);

    if ($err) {
        return ['success' => false, 'error' => $err];
    }
    return json_decode($response, true);
}
