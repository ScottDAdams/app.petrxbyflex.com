"""Admin user management routes."""

from flask import flash, redirect, render_template, request, url_for

from ..auth import get_current_admin, require_admin
from ..services.admin_users import (
    admin_is_active,
    create_admin_user,
    list_admin_users,
    set_admin_active,
    update_admin_password,
)
from .admin import admin_bp, PETRX_LOGO_URL


@admin_bp.route('/admin-users')
@require_admin
def admin_users_list():
    current = get_current_admin()
    users = list_admin_users()
    return render_template(
        'admin/admin_users.html',
        users=users,
        current_email=current,
    )


@admin_bp.route('/admin-users/new', methods=['GET', 'POST'])
@require_admin
def admin_users_new():
    if request.method == 'POST':
        email = request.form.get('email', '')
        password = request.form.get('password', '')
        password2 = request.form.get('password_confirm', '')
        display_name = request.form.get('display_name', '')

        if password != password2:
            flash('Passwords do not match.', 'error')
        else:
            ok, msg = create_admin_user(email, password, display_name)
            flash(msg, 'success' if ok else 'error')
            if ok:
                return redirect(url_for('admin.admin_users_list'))

    return render_template('admin/admin_user_form.html', user=None)


@admin_bp.route('/admin-users/<int:user_id>/deactivate', methods=['POST'])
@require_admin
def admin_users_deactivate(user_id):
    current = get_current_admin() or ''
    ok, msg = set_admin_active(user_id, False, current_email=current)
    flash(msg, 'success' if ok else 'error')
    return redirect(url_for('admin.admin_users_list'))


@admin_bp.route('/admin-users/<int:user_id>/activate', methods=['POST'])
@require_admin
def admin_users_activate(user_id):
    current = get_current_admin() or ''
    ok, msg = set_admin_active(user_id, True, current_email=current)
    flash(msg, 'success' if ok else 'error')
    return redirect(url_for('admin.admin_users_list'))


@admin_bp.route('/admin-users/<int:user_id>/password', methods=['GET', 'POST'])
@require_admin
def admin_users_password(user_id):
    current = get_current_admin() or ''
    users = list_admin_users()
    target = next((u for u in users if u['id'] == user_id), None)
    if not target:
        flash('Admin user not found.', 'error')
        return redirect(url_for('admin.admin_users_list'))

    is_self = (target['email'] or '').lower() == current.lower()

    if request.method == 'POST':
        new_password = request.form.get('password', '')
        new_password2 = request.form.get('password_confirm', '')
        if new_password != new_password2:
            flash('Passwords do not match.', 'error')
        else:
            ok, msg = update_admin_password(
                user_id,
                new_password,
                current_email=current,
                allow_any_admin=not is_self,  # any active admin may reset another user
            )
            flash(msg, 'success' if ok else 'error')
            if ok:
                return redirect(url_for('admin.admin_users_list'))

    return render_template(
        'admin/admin_user_password.html',
        user=target,
        is_self=is_self,
    )
