"""Register Flask blueprints (called after all view implementations are defined in webapp)."""


def register_http_routes(app):
    from kernel_ai.api.rest import bp as api_bp
    from kernel_ai.views.pages import bp as pages_bp

    app.register_blueprint(pages_bp)
    app.register_blueprint(api_bp)
