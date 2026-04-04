"""Register Flask blueprints for pages and API modules."""


def register_http_routes(app):
    # Keep import-callables lazy to avoid import cycles at app bootstrap.
    blueprint_loaders = [
        lambda: __import__("kernel_ai.views.pages", fromlist=["bp"]).bp,
        lambda: __import__("kernel_ai.api.rest", fromlist=["bp"]).bp,
    ]

    for load_bp in blueprint_loaders:
        app.register_blueprint(load_bp())
