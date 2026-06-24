from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, scoped_session
from contextlib import contextmanager
import logging

from ..config import Config

logger = logging.getLogger(__name__)

engine = create_engine(
    Config.DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=180,
    pool_size=2,
    max_overflow=3,
    pool_timeout=10,
    connect_args={
        "connect_timeout": 5,
        "application_name": "petrx-admin-web",
        "options": "-c statement_timeout=8000",
        "sslmode": "require",
        "gssencmode": "disable",
        "target_session_attrs": "read-write",
    },
)

SessionFactory = sessionmaker(bind=engine, expire_on_commit=False, autocommit=False, autoflush=False)
Session = scoped_session(SessionFactory)


@contextmanager
def get_db():
    db = Session()
    try:
        yield db
        db.commit()
    except Exception as e:
        logger.error(f"DB error: {e}")
        db.rollback()
        raise
    finally:
        db.close()
        Session.remove()
