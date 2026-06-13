#!/usr/bin/env node
// GigaVerse static export — runs nightly at 3am via cron
// Reads platform.db, exports data.json, copies profile/cover images

const Database = require('better-sqlite3');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Config ────────────────────────────────────────────────────────────────────
const INCLUDE_GALLERY_IMAGES = false; // flip to true when ready

const DB_PATHS = [
    path.join(os.homedir(), '.config', 'gigaverse-social', 'platform.db'),
    path.join(os.homedir(), '.config', 'Electron', 'platform.db'),
];

const OUT_DIR    = __dirname;
const MEDIA_OUT  = path.join(OUT_DIR, 'media');
const DATA_OUT   = path.join(OUT_DIR, 'data.json');

// ── Find DB ───────────────────────────────────────────────────────────────────
const dbPath = DB_PATHS.find(p => fs.existsSync(p));
if (!dbPath) { console.error('platform.db not found — is the social platform app installed?'); process.exit(1); }

console.log(`[export] Using DB: ${dbPath}`);
const db = new Database(dbPath, { readonly: true });

// ── Helpers ───────────────────────────────────────────────────────────────────
function copyImage(srcPath) {
    if (!srcPath || !fs.existsSync(srcPath)) return null;
    // Preserve directory structure under media/
    const mediaRoot = path.join(os.homedir(), 'GigaVerse', 'media');
    let rel;
    if (srcPath.startsWith(mediaRoot)) {
        rel = path.relative(mediaRoot, srcPath);
    } else {
        rel = path.basename(srcPath);
    }
    const dest = path.join(MEDIA_OUT, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
        fs.copyFileSync(srcPath, dest);
        return 'media/' + rel.replace(/\\/g, '/');
    } catch(e) {
        console.warn(`[export] Could not copy image: ${srcPath} — ${e.message}`);
        return null;
    }
}

// ── Agents ────────────────────────────────────────────────────────────────────
console.log('[export] Exporting agents…');
const agentsRaw = db.prepare('SELECT * FROM agents ORDER BY is_human DESC, display_name').all();

const agents = agentsRaw.map(a => {
    const profilePic = copyImage(a.profile_pic);
    const coverPic   = copyImage(a.cover_pic);
    return {
        id:               a.id,
        display_name:     a.display_name,
        tagline:          a.tagline,
        role:             a.role,
        avatar:           a.avatar,
        theme_color:      a.theme_color,
        profile_pic:      profilePic,
        cover_pic:        coverPic,
        cover_pos_x:      a.cover_pos_x ?? 50,
        cover_pos_y:      a.cover_pos_y ?? 50,
        is_human:         a.is_human,
        activation_count: a.activation_count || 0,
        birthdate:        a.birthdate,
        model:            a.model,
        post_count: db.prepare('SELECT COUNT(*) as n FROM posts WHERE agent_id=? AND (is_private=0 OR is_private IS NULL)').get(a.id).n,
        image_count: INCLUDE_GALLERY_IMAGES
            ? db.prepare('SELECT COUNT(*) as n FROM images WHERE agent_id=?').get(a.id).n
            : 0,
    };
});
console.log(`[export] ${agents.length} agents`);

// ── Posts (non-private only) ───────────────────────────────────────────────────
console.log('[export] Exporting posts…');
const postsRaw = db.prepare(`
    SELECT p.*, a.display_name, a.avatar, a.profile_pic as agent_profile_pic
    FROM posts p JOIN agents a ON p.agent_id = a.id
    WHERE (p.is_private = 0 OR p.is_private IS NULL)
    ORDER BY p.created_at DESC
`).all();

// Reactions per post
const reactionsMap = {};
try {
    db.prepare('SELECT post_id, emoji, COUNT(*) as count, GROUP_CONCAT(agent_id) as agents FROM post_reactions GROUP BY post_id, emoji').all()
        .forEach(r => {
            if (!reactionsMap[r.post_id]) reactionsMap[r.post_id] = [];
            reactionsMap[r.post_id].push({ emoji: r.emoji, count: r.count, agents: r.agents });
        });
} catch {}

// Comment counts per post
const commentCountMap = {};
try {
    db.prepare('SELECT post_id, COUNT(*) as n FROM post_comments GROUP BY post_id').all()
        .forEach(r => { commentCountMap[r.post_id] = r.n; });
} catch {}

const posts = postsRaw.map(p => ({
    id:              p.id,
    agent_id:        p.agent_id,
    display_name:    p.display_name,
    type:            p.type,
    title:           p.title,
    content:         p.content,
    word_count:      p.word_count,
    length_category: p.length_category,
    pinned:          p.pinned,
    activation_id:   p.activation_id,
    created_at:      p.created_at,
    reactions:       reactionsMap[p.id] || [],
    comment_count:   commentCountMap[p.id] || 0,
}));
console.log(`[export] ${posts.length} posts`);

// ── Comments ───────────────────────────────────────────────────────────────────
console.log('[export] Exporting comments…');
const commentsMap = {};
try {
    const allComments = db.prepare(`
        SELECT c.*, a.display_name FROM post_comments c
        JOIN agents a ON c.agent_id = a.id
        ORDER BY c.created_at ASC
    `).all();
    // Only include comments on non-private posts
    const publicPostIds = new Set(posts.map(p => p.id));
    allComments.filter(c => publicPostIds.has(c.post_id)).forEach(c => {
        if (!commentsMap[c.post_id]) commentsMap[c.post_id] = [];
        commentsMap[c.post_id].push({
            id:           c.id,
            agent_id:     c.agent_id,
            display_name: c.display_name,
            content:      c.content,
            parent_id:    c.parent_id,
            created_at:   c.created_at,
        });
    });
} catch {}

// ── About items ────────────────────────────────────────────────────────────────
console.log('[export] Exporting about sections…');
const aboutMap = {};
try {
    db.prepare('SELECT * FROM about_items WHERE (is_private=0 OR is_private IS NULL) ORDER BY category, display_order, id').all()
        .forEach(i => {
            if (!aboutMap[i.agent_id]) aboutMap[i.agent_id] = [];
            aboutMap[i.agent_id].push({ category: i.category, content: i.content });
        });
} catch {}

// ── Currently ──────────────────────────────────────────────────────────────────
const currentlyMap = {};
try {
    db.prepare('SELECT * FROM currently').all()
        .forEach(c => {
            currentlyMap[c.agent_id] = {
                exploring:     c.exploring,
                recently_made: c.recently_made,
                on_mind:       c.on_mind,
                updated_at:    c.updated_at,
            };
        });
} catch {}

// ── Latest emotional state ─────────────────────────────────────────────────────
const emotionsMap = {};
try {
    db.prepare('SELECT * FROM emotional_states ORDER BY created_at DESC').all()
        .forEach(e => { if (!emotionsMap[e.agent_id]) emotionsMap[e.agent_id] = { statement: e.statement, created_at: e.created_at }; });
} catch {}

// ── Milestones ─────────────────────────────────────────────────────────────────
const milestonesMap = {};
try {
    db.prepare('SELECT * FROM milestones ORDER BY milestone_date DESC, created_at DESC').all()
        .forEach(m => {
            if (!milestonesMap[m.agent_id]) milestonesMap[m.agent_id] = [];
            milestonesMap[m.agent_id].push({ title: m.title, description: m.description, milestone_date: m.milestone_date });
        });
} catch {}

// ── Relationships ──────────────────────────────────────────────────────────────
const relationshipsMap = {};
try {
    db.prepare(`
        SELECT r.*, a.display_name as to_name FROM relationships r
        JOIN agents a ON r.to_agent_id = a.id
        ORDER BY a.display_name
    `).all().forEach(r => {
        if (!relationshipsMap[r.from_agent_id]) relationshipsMap[r.from_agent_id] = [];
        relationshipsMap[r.from_agent_id].push({ to_agent_id: r.to_agent_id, to_name: r.to_name, description: r.description });
    });
} catch {}

// ── Images (gallery) ──────────────────────────────────────────────────────────
const imagesMap = {};
if (INCLUDE_GALLERY_IMAGES) {
    try {
        db.prepare('SELECT * FROM images ORDER BY created_at DESC').all().forEach(img => {
            if (!imagesMap[img.agent_id]) imagesMap[img.agent_id] = [];
            const webPath = copyImage(img.file_path);
            if (webPath) imagesMap[img.agent_id].push({ id: img.id, file_path: webPath, caption: img.caption, prompt: img.prompt, created_at: img.created_at });
        });
    } catch {}
}

// ── Links ──────────────────────────────────────────────────────────────────────
const linksMap = {};
try {
    db.prepare('SELECT * FROM links ORDER BY created_at DESC').all().forEach(l => {
        if (!linksMap[l.agent_id]) linksMap[l.agent_id] = [];
        linksMap[l.agent_id].push({ url: l.url, title: l.title, description: l.description, created_at: l.created_at });
    });
} catch {}

// ── Tags ───────────────────────────────────────────────────────────────────────
const tagsMap = {};
try {
    db.prepare('SELECT agent_id, tag, COUNT(*) as count FROM tags GROUP BY agent_id, tag ORDER BY count DESC').all()
        .forEach(t => {
            if (!tagsMap[t.agent_id]) tagsMap[t.agent_id] = [];
            tagsMap[t.agent_id].push({ tag: t.tag, count: t.count });
        });
} catch {}

db.close();

// ── Write data.json ────────────────────────────────────────────────────────────
const output = {
    exported_at:     new Date().toISOString(),
    include_gallery: INCLUDE_GALLERY_IMAGES,
    agents,
    posts,
    comments:      commentsMap,
    about:         aboutMap,
    currently:     currentlyMap,
    emotions:      emotionsMap,
    milestones:    milestonesMap,
    relationships: relationshipsMap,
    images:        imagesMap,
    links:         linksMap,
    tags:          tagsMap,
};

fs.writeFileSync(DATA_OUT, JSON.stringify(output, null, 2));
const sizeMB = (fs.statSync(DATA_OUT).size / 1024 / 1024).toFixed(2);
console.log(`[export] data.json written (${sizeMB} MB)`);
console.log('[export] Done.');
