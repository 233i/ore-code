use super::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillPathResult {
    pub(crate) root_path: String,
    pub(crate) skill_path: String,
}

#[tauri::command]
pub(crate) fn skill_create(
    app: tauri::AppHandle,
    id: String,
    content: String,
) -> Result<SkillPathResult, String> {
    let root = skill_root_dir(&app)?;
    let skill_dir = skill_dir_for_id(&root, &id)?;
    if skill_dir.exists() {
        return Err(format!("skill already exists: {id}"));
    }

    fs::create_dir_all(skill_dir.join("scripts")).map_err(|error| error.to_string())?;
    fs::create_dir_all(skill_dir.join("examples")).map_err(|error| error.to_string())?;
    fs::create_dir_all(skill_dir.join("templates")).map_err(|error| error.to_string())?;
    fs::write(skill_dir.join("SKILL.md"), content.as_bytes()).map_err(|error| error.to_string())?;
    Ok(skill_path_result(skill_dir))
}

#[tauri::command]
pub(crate) fn skill_update(
    app: tauri::AppHandle,
    id: String,
    content: String,
) -> Result<SkillPathResult, String> {
    let root = skill_root_dir(&app)?;
    let skill_dir = skill_dir_for_id(&root, &id)?;
    if !skill_dir.is_dir() {
        return Err(format!("skill does not exist: {id}"));
    }

    fs::write(skill_dir.join("SKILL.md"), content.as_bytes()).map_err(|error| error.to_string())?;
    Ok(skill_path_result(skill_dir))
}

#[tauri::command]
pub(crate) fn skill_rename(
    app: tauri::AppHandle,
    from_id: String,
    to_id: String,
) -> Result<SkillPathResult, String> {
    let root = skill_root_dir(&app)?;
    let from_dir = skill_dir_for_id(&root, &from_id)?;
    let to_dir = skill_dir_for_id(&root, &to_id)?;
    rename_skill_dir(&from_dir, &to_dir, &from_id, &to_id)?;
    Ok(skill_path_result(to_dir))
}

#[tauri::command]
pub(crate) fn skill_trash(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let root = skill_root_dir(&app)?;
    let skill_dir = skill_dir_for_id(&root, &id)?;
    trash_skill_dir(&skill_dir)
}

pub(crate) fn skill_root_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .home_dir()
        .map_err(|error| error.to_string())?
        .join(".ore-code")
        .join("skills"))
}

pub(crate) fn skill_dir_for_id(root: &Path, id: &str) -> Result<PathBuf, String> {
    validate_skill_id(id)?;
    Ok(root.join(id))
}

pub(crate) fn validate_skill_id(id: &str) -> Result<(), String> {
    if id.len() < 2 || id.len() > 64 {
        return Err("skill id length must be 2-64 characters".to_string());
    }
    if id.starts_with('-') || id.ends_with('-') {
        return Err("skill id cannot start or end with '-'".to_string());
    }
    if !id.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        return Err("skill id may only contain lowercase letters, digits, and '-'".to_string());
    }
    Ok(())
}

pub(crate) fn skill_path_result(skill_dir: PathBuf) -> SkillPathResult {
    SkillPathResult {
        root_path: skill_dir.display().to_string(),
        skill_path: skill_dir.join("SKILL.md").display().to_string(),
    }
}

pub(crate) fn rename_skill_dir(
    from_dir: &Path,
    to_dir: &Path,
    from_id: &str,
    to_id: &str,
) -> Result<(), String> {
    if !from_dir.is_dir() {
        return Err(format!("skill does not exist: {from_id}"));
    }
    if to_dir.exists() {
        return Err(format!("skill already exists: {to_id}"));
    }

    fs::rename(from_dir, to_dir).map_err(|error| error.to_string())
}

pub(crate) fn trash_skill_dir(skill_dir: &Path) -> Result<(), String> {
    if !skill_dir.is_dir() {
        return Err(format!(
            "skill directory does not exist: {}",
            skill_dir.display()
        ));
    }
    trash::delete(skill_dir).map_err(|error| error.to_string())
}
